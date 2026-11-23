import net from "node:net";
import tls from "node:tls";

import { MAIL_RAW_MAX_BYTES, MailReaderError, type ServerConfig } from "./types";

const IDLE_TIMEOUT_MS = 30_000;
const COMMAND_DEADLINE_MS = 120_000;
const MAX_LINE_BYTES = 4096;
/** Multi-line response cap: raw cap plus headroom for headers and dot-stuffing. */
const MAX_MULTI_BYTES = MAIL_RAW_MAX_BYTES + 64 * 1024;
const TERMINATOR = Buffer.from("\r\n.\r\n");

type MultiState = {
  chunks: Buffer[];
  total: number;
  tail: Buffer;
  resolve: (b: Buffer) => void;
  reject: (e: Error) => void;
};

/** Minimal POP3 client. Runs one command at a time. Read-only (no DELE). */
export class Pop3Client {
  private socket!: net.Socket;
  private buf: Buffer = Buffer.alloc(0);
  private error: Error | null = null;
  private wake: (() => void) | null = null;
  private multi: MultiState | null = null;

  private fail(e: Error): void {
    if (!this.error) this.error = e;
    this.socket?.destroy();
    this.multi?.reject(this.error);
    this.multi = null;
    this.wake?.();
  }

  async connect(cfg: ServerConfig): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sock: net.Socket = cfg.tls
        ? tls.connect({ host: cfg.host, port: cfg.port, servername: net.isIP(cfg.host) ? undefined : cfg.host }, () => resolve())
        : net.connect({ host: cfg.host, port: cfg.port }, () => resolve());
      this.socket = sock;
      sock.setTimeout(IDLE_TIMEOUT_MS, () => sock.destroy(new Error("timeout")));
      sock.once("error", () => reject(new MailReaderError("CONNECT_FAILED", "connection failed")));
      sock.on("error", () => this.fail(new MailReaderError("CONNECT_FAILED", "connection failed")));
      sock.on("close", () => this.fail(new MailReaderError("CONNECT_FAILED", "connection closed")));
      sock.on("data", (c: Buffer) => this.onData(c));
    });
    const greeting = await this.withDeadline(this.readLine());
    if (!greeting.startsWith("+OK")) throw new MailReaderError("PROTOCOL", "bad greeting");
  }

  private onData(chunk: Buffer): void {
    if (this.multi) {
      this.feedMulti(chunk);
      return;
    }
    this.buf = Buffer.concat([this.buf, chunk]);
    this.wake?.();
  }

  /** Collects chunks and searches for the terminator only in the new piece (plus a 4-byte overlap). */
  private feedMulti(piece: Buffer): void {
    const m = this.multi;
    if (!m) return;
    const window = Buffer.concat([m.tail, piece]);
    const i = window.indexOf(TERMINATOR);
    // Virtual stream = "\r\n" + body, so an empty body (".\r\n") matches the same terminator.
    const vBefore = 2 + m.total;
    m.chunks.push(piece);
    m.total += piece.length;
    if (i >= 0) {
      const q = vBefore - m.tail.length + i;
      const all = Buffer.concat(m.chunks);
      this.multi = null;
      const rest = all.subarray(q + 3); // skip the 3 bytes of "\r\n.\r\n" outside the body (".\r\n")
      if (rest.length) this.buf = Buffer.concat([this.buf, rest]);
      m.resolve(unstuff(all.subarray(0, q)));
      return;
    }
    if (m.total > MAX_MULTI_BYTES) {
      this.fail(new MailReaderError("PROTOCOL", "response too large"));
      return;
    }
    m.tail = window.subarray(Math.max(0, window.length - 4));
  }

  private async waitData(): Promise<void> {
    if (this.error) throw this.error;
    await new Promise<void>((resolve) => {
      this.wake = () => {
        this.wake = null;
        resolve();
      };
    });
    if (this.error) throw this.error;
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf("\r\n");
      if (i >= 0) {
        const line = this.buf.subarray(0, i).toString("latin1");
        this.buf = this.buf.subarray(i + 2);
        return line;
      }
      if (this.buf.length > MAX_LINE_BYTES) {
        this.fail(new MailReaderError("PROTOCOL", "line too long"));
        throw this.error!;
      }
      await this.waitData();
    }
  }

  private readMultiline(): Promise<Buffer> {
    if (this.error) return Promise.reject(this.error);
    return new Promise<Buffer>((resolve, reject) => {
      this.multi = { chunks: [], total: 0, tail: Buffer.from("\r\n"), resolve, reject };
      const initial = this.buf;
      this.buf = Buffer.alloc(0);
      if (initial.length) this.feedMulti(initial);
    });
  }

  private withDeadline<T>(p: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const e = new MailReaderError("CONNECT_FAILED", "command deadline exceeded");
        this.fail(e);
        reject(e);
      }, COMMAND_DEADLINE_MS);
    });
    return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
  }

  private async status(line: string, auth = false): Promise<void> {
    this.socket.write(line + "\r\n");
    const resp = await this.readLine();
    if (resp.startsWith("+OK")) return;
    throw new MailReaderError(auth ? "AUTH_FAILED" : "PROTOCOL", auth ? "authentication failed" : "server error");
  }

  async login(user: string, password: string): Promise<void> {
    // Prevent command injection: never send values containing line breaks.
    if (/[\r\n]/.test(user) || /[\r\n]/.test(password)) {
      throw new MailReaderError("AUTH_FAILED", "invalid credentials");
    }
    await this.withDeadline(this.status(`USER ${user}`, true));
    await this.withDeadline(this.status(`PASS ${password}`, true));
  }

  private multiCmd(line: string): Promise<Buffer> {
    return this.withDeadline(
      (async () => {
        await this.status(line);
        return this.readMultiline();
      })(),
    );
  }

  async uidl(): Promise<{ msgNo: number; uidl: string }[]> {
    const body = (await this.multiCmd("UIDL")).toString("latin1");
    return body
      .split("\r\n")
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length >= 2 && /^\d+$/.test(p[0]))
      .map((p) => ({ msgNo: Number(p[0]), uidl: p[1] }));
  }

  async sizes(): Promise<Map<number, number>> {
    const body = (await this.multiCmd("LIST")).toString("latin1");
    const out = new Map<number, number>();
    for (const l of body.split("\r\n")) {
      const p = l.trim().split(/\s+/);
      if (p.length >= 2 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1])) out.set(Number(p[0]), Number(p[1]));
    }
    return out;
  }

  retr(n: number): Promise<Buffer> {
    return this.multiCmd(`RETR ${n}`);
  }

  /** Headers only (zero body lines). */
  top(n: number): Promise<Buffer> {
    return this.multiCmd(`TOP ${n} 0`);
  }

  async quit(): Promise<void> {
    try {
      if (this.socket && !this.error && !this.socket.destroyed) {
        this.socket.write("QUIT\r\n");
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            this.readLine(),
            new Promise((r) => {
              timer = setTimeout(r, 2000);
              timer.unref();
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    } catch {
      /* ignore */
    } finally {
      this.socket?.destroy();
    }
  }
}

/** Undoes dot-stuffing. Input is the body including the CRLF of its last line. */
function unstuff(body: Buffer): Buffer {
  const lines = body.toString("latin1").split("\r\n").map((l) => (l.startsWith("..") ? l.slice(1) : l));
  return Buffer.from(lines.join("\r\n"), "latin1");
}
