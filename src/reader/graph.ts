/**
 * Microsoft Graph mail reader: inbox delta query plus MIME download.
 *
 * Official docs (checked 2026-11-20):
 * - message: delta - https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0
 *   Supports `$select`, `$top`, `$expand`. `$filter` supports only `receivedDateTime ge|gt {value}`.
 *   Query options go on the first request only; afterwards the `@odata.nextLink` / `@odata.deltaLink` URL is used
 *   as is (the options are baked into the token). Changes that do not match the filter (`@removed`, read-state
 *   changes) can still arrive, so on the initial delta (and after a reset) results are filtered again by
 *   receivedDateTime. When resuming from a stored cursor they are not filtered (avoids losing mail after a long pause).
 *   The custom option `changeType=created` narrows later rounds to new mail (read-state changes do not refetch MIME).
 * - Use delta query for messages - https://learn.microsoft.com/en-us/graph/delta-query-messages
 *   With `$filter` at most 5,000 items are returned. Page size is set with the `Prefer: odata.maxpagesize={x}` header.
 * - Delta query overview - https://learn.microsoft.com/en-us/graph/delta-query-overview
 *   A response never carries both nextLink and deltaLink. Keep following nextLink even on an empty page.
 *   Sync reset = `410 Gone`, expired token = 40X + `syncStateNotFound` -> restart from scratch (full sync).
 * - Get MIME content - https://learn.microsoft.com/en-us/graph/outlook-get-mime-message
 *   `GET /me/messages/{id}/$value` returns the MIME source.
 *
 * Talks only to graph.microsoft.com, so it takes no host guard. Tokens come only from the config's supplier,
 * and error messages are fixed strings (no response bodies or tokens).
 */
import { stableMessageKey } from "./message-key";
import { MAIL_RAW_MAX_BYTES, MailReaderError, type FetchResult, type GraphConfig, type MailReader, type RawMail } from "./types";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const DELTA_PATH = "/me/mailFolders/inbox/messages/delta";
/** Max pages followed in one fetch (so a run of empty pages still ends). Past it, nextLink becomes the cursor for the next cycle. */
const MAX_PAGES = 20;
const MAX_PAGE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 30_000;
const MIME_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
/**
 * Total time budget for one fetchSince. Must stay shorter than the caller's sync lease (the original consumer
 * holds a 2-minute lock per mailbox). When exceeded, returns the mails finished so far and keeps the URL of the
 * unfinished page as the cursor (refetched mails are deduplicated by stableMessageKey).
 */
const FETCH_BUDGET_MS = 90_000;
const SYNC_RESET_CODES = new Set(["syncstatenotfound", "syncstateinvalid", "resyncrequired"]);

type DeltaItem = { id?: string; receivedDateTime?: string; "@removed"?: unknown };
type DeltaPage = { value?: DeltaItem[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
type MessageMeta = {
  subject?: string | null;
  internetMessageId?: string | null;
  receivedDateTime?: string | null;
  from?: { emailAddress?: { name?: string | null; address?: string | null } | null } | null;
};

class SyncReset extends Error {}

/** Time budget: request timeouts never exceed the time left. */
type Budget = { left: () => number };

function fetchOf(cfg: GraphConfig): typeof fetch {
  return cfg.fetch ?? fetch;
}

function isGraphUrl(u: string): boolean {
  return u.startsWith(`${GRAPH_BASE}/`);
}

function initialDeltaUrl(since: Date): string {
  const iso = since.toISOString().replace(/\.\d{3}Z$/, "Z");
  return (
    `${GRAPH_BASE}${DELTA_PATH}?changeType=created` +
    `&$select=id,internetMessageId,receivedDateTime` +
    `&$filter=${encodeURIComponent(`receivedDateTime ge ${iso}`)}`
  );
}

function timeout(budget: Budget, cap: number): number {
  return Math.max(MIN_TIMEOUT_MS, Math.min(cap, budget.left()));
}

/** Folds a status code into a reader error. Response bodies and tokens never go into the message. */
function statusError(status: number): MailReaderError {
  if (status === 401) return new MailReaderError("AUTH_FAILED", "Graph authentication failed");
  if (status === 429 || status === 408 || status === 423 || status === 425 || status >= 500) return new MailReaderError("CONNECT_FAILED", "Graph service unavailable");
  return new MailReaderError("PROTOCOL", "Graph request rejected");
}

/**
 * Permanent rejection of a single mail (4xx except 401 and 429; 408, 423, 425 are transient, so they are not skipped
 * but fail with CONNECT_FAILED and retry next time). Skips only that mail instead of blocking the whole mailbox.
 */
function isPerMessageSkip(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 429 && status !== 408 && status !== 423 && status !== 425;
}

async function request(cfg: GraphConfig, token: string, url: string, extra: Record<string, string>, timeoutMs: number): Promise<Response> {
  try {
    return await fetchOf(cfg)(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, ...extra },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new MailReaderError("CONNECT_FAILED", "Graph request failed");
  }
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

/** Body read failure (network, timeout) is CONNECT_FAILED; only a JSON parse failure is PROTOCOL. */
async function readJson<T>(res: Response): Promise<T> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new MailReaderError("CONNECT_FAILED", "Graph response interrupted");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MailReaderError("PROTOCOL", "Graph response malformed");
  }
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    return typeof body?.error?.code === "string" ? body.error.code.toLowerCase() : "";
  } catch {
    return "";
  }
}

async function getDeltaPage(
  cfg: GraphConfig, token: string, url: string, pageSize: number, resettable: boolean, budget: Budget,
): Promise<DeltaPage> {
  const res = await request(
    cfg, token, url,
    { accept: "application/json", prefer: `odata.maxpagesize=${pageSize}` },
    timeout(budget, REQUEST_TIMEOUT_MS),
  );
  if (res.ok) return readJson<DeltaPage>(res);
  if (resettable && (res.status === 410 || (res.status >= 400 && res.status < 500 && SYNC_RESET_CODES.has(await errorCode(res))))) {
    throw new SyncReset();
  }
  await discard(res);
  throw statusError(res.status);
}

/** Reads the raw message up to the cap only. Past it, stops reading (cancels the stream) and returns null. */
async function readCapped(res: Response): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAIL_RAW_MAX_BYTES) {
    await discard(res);
    return null;
  }
  try {
    if (!res.body) return Buffer.from(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAIL_RAW_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch {
    throw new MailReaderError("CONNECT_FAILED", "Graph download failed");
  }
}

/** Removes line breaks from a header value and RFC 2047-encodes non-ASCII text. */
function headerValue(v: string): string {
  const flat = v.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${Buffer.from(flat, "utf8").toString("base64")}?=`;
}

/** Builds a header block (no body) from metadata only, for mails over the cap. */
function headerOnlyRaw(meta: MessageMeta): Buffer {
  const lines: string[] = [];
  const mid = meta.internetMessageId?.replace(/[\r\n<>]+/g, "").trim();
  if (mid) lines.push(`Message-ID: <${mid}>`);
  const addr = meta.from?.emailAddress?.address?.replace(/[\r\n<>]+/g, "").trim();
  const name = meta.from?.emailAddress?.name?.trim();
  if (addr) lines.push(`From: ${name ? `${headerValue(name.replace(/"/g, ""))} ` : ""}<${addr}>`);
  if (meta.subject) lines.push(`Subject: ${headerValue(meta.subject)}`);
  const t = meta.receivedDateTime ? Date.parse(meta.receivedDateTime) : NaN;
  if (!Number.isNaN(t)) lines.push(`Date: ${new Date(t).toUTCString().replace("GMT", "+0000")}`);
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "utf8");
}

/** Downloads one mail. Returns null (skip) when it was deleted (404) or permanently rejected on its own (other 4xx). */
async function downloadMessage(cfg: GraphConfig, token: string, id: string, budget: Budget): Promise<RawMail | null> {
  const base = `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}`;
  const res = await request(cfg, token, `${base}/$value`, {}, timeout(budget, MIME_TIMEOUT_MS));
  if (!res.ok) {
    await discard(res);
    if (isPerMessageSkip(res.status)) return null;
    throw statusError(res.status);
  }
  const raw = await readCapped(res);
  if (raw) return { providerMessageId: stableMessageKey(raw), raw };

  const metaRes = await request(
    cfg, token, `${base}?$select=subject,from,receivedDateTime,internetMessageId`,
    { accept: "application/json" }, timeout(budget, REQUEST_TIMEOUT_MS),
  );
  if (!metaRes.ok) {
    await discard(metaRes);
    if (isPerMessageSkip(metaRes.status)) return null;
    throw statusError(metaRes.status);
  }
  const head = headerOnlyRaw(await readJson<MessageMeta>(metaRes));
  return { providerMessageId: stableMessageKey(head), raw: head, oversized: true };
}

/** Creates a Graph reader. `now` and `budgetMs` can be swapped (mainly for tests); defaults are Date.now and 90 s. */
export function createGraphReader(o: { now?: () => number; budgetMs?: number } = {}): MailReader<GraphConfig> {
  const now = o.now ?? Date.now;
  const budgetMs = o.budgetMs ?? FETCH_BUDGET_MS;

  return {
    transport: "GRAPH",

    async verify(cfg) {
      const token = await cfg.getAccessToken();
      const res = await request(cfg, token, `${GRAPH_BASE}/me`, { accept: "application/json" }, REQUEST_TIMEOUT_MS);
      if (!res.ok) {
        await discard(res);
        throw statusError(res.status);
      }
      await readJson<unknown>(res);
    },

    async fetchSince(cfg, state, opts): Promise<FetchResult> {
      const deadline = now() + budgetMs;
      const budget: Budget = { left: () => deadline - now() };
      const token = await cfg.getAccessToken();
      const limit = Math.max(1, opts.limit);
      const stored = state.cursor && isGraphUrl(state.cursor) ? state.cursor : null;

      /**
       * filterSince: whether to drop receivedDateTime < since after receiving. Only on the initial delta (or a 410 restart).
       * Filtering while resuming from a stored cursor would make the cursor skip, forever, mail that arrived while
       * collection was stopped for longer than the `since` window.
       */
      const run = async (start: string, resettable: boolean, filterSince: boolean): Promise<FetchResult> => {
        const items: RawMail[] = [];
        let url = start;
        for (let page = 0; page < MAX_PAGES; page++) {
          // The first page is fetched regardless of the budget (guarantees minimal progress each cycle).
          if (page > 0 && budget.left() <= 0) return { items, nextCursor: url, hasMore: true };
          const remaining = limit - items.length;
          // Reset (410, syncStateNotFound) is honoured only on the first page of a stored cursor, before anything was received.
          const body = await getDeltaPage(cfg, token, url, Math.min(MAX_PAGE_SIZE, remaining), resettable && page === 0, budget);
          for (const it of body.value ?? []) {
            if (it["@removed"] || typeof it.id !== "string" || !it.id) continue;
            if (filterSince) {
              const at = it.receivedDateTime ? Date.parse(it.receivedDateTime) : NaN;
              if (!Number.isNaN(at) && at < opts.since.getTime()) continue;
            }
            // Budget spent: this page is unfinished, so keep its URL as the cursor and refetch it next cycle.
            if (budget.left() <= 0) return { items, nextCursor: url, hasMore: true };
            const m = await downloadMessage(cfg, token, it.id, budget);
            if (m) items.push(m);
          }
          const next = body["@odata.nextLink"];
          const delta = body["@odata.deltaLink"];
          if (typeof next === "string" && next) {
            if (!isGraphUrl(next)) throw new MailReaderError("PROTOCOL", "Graph returned unexpected link");
            url = next;
            if (items.length >= limit) return { items, nextCursor: url, hasMore: true };
            continue;
          }
          if (typeof delta === "string" && delta && isGraphUrl(delta)) return { items, nextCursor: delta, hasMore: false };
          throw new MailReaderError("PROTOCOL", "Graph returned no continuation link");
        }
        return { items, nextCursor: url, hasMore: true };
      };

      if (!stored) return run(initialDeltaUrl(opts.since), false, true);
      try {
        return await run(stored, true, false);
      } catch (e) {
        if (!(e instanceof SyncReset)) throw e;
        return run(initialDeltaUrl(opts.since), false, true);
      }
    },
  };
}

