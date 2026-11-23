import net from "node:net";

export type FakePop3Message = { uidl: string; raw: string | Buffer };

export type FakePop3Options = {
  messages: FakePop3Message[];
  user?: string;
  password?: string;
  /** Streams the UIDL response forever without a terminator (simulates a malicious server). */
  floodOnUidl?: boolean;
};

export type FakePop3 = {
  port: number;
  /** Received command lines (upper-case verb + arguments). Passwords are not recorded. */
  commands: string[];
  /** Number of TCP connections accepted so far. */
  readonly connections: number;
  setMessages(messages: FakePop3Message[]): void;
  close(): Promise<void>;
};

function stuff(raw: Buffer): Buffer {
  const text = raw.toString("latin1").replace(/\r?\n/g, "\r\n");
  const lines = text.split("\r\n").map((l) => (l.startsWith(".") ? "." + l : l));
  return Buffer.from(lines.join("\r\n") + (text.endsWith("\r\n") ? "" : "\r\n") + ".\r\n", "latin1");
}

/** Plain-text POP3 server for tests. Supports USER/PASS/STAT/LIST/UIDL/RETR/TOP/QUIT. */
export async function startFakePop3(opts: FakePop3Options): Promise<FakePop3> {
  let messages = [...opts.messages];
  const user = opts.user ?? "user";
  const password = opts.password ?? "pass";
  const commands: string[] = [];
  let connections = 0;

  const server = net.createServer((socket) => {
    connections++;
    let authed = false;
    let userOk = false;
    let buf = "";
    const send = (s: string | Buffer) => socket.write(s);
    send("+OK fake pop3 ready\r\n");
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      let idx: number;
      while ((idx = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const [verbRaw, ...args] = line.split(" ");
        const verb = verbRaw.toUpperCase();
        commands.push(verb === "PASS" ? "PASS" : line.trim());
        const msg = (n: string) => messages[Number(n) - 1];
        if (verb === "USER") {
          userOk = args[0] === user;
          send("+OK\r\n");
        } else if (verb === "PASS") {
          authed = userOk && args.join(" ") === password;
          send(authed ? "+OK logged in\r\n" : "-ERR invalid credentials\r\n");
        } else if (verb === "QUIT") {
          send("+OK bye\r\n");
          socket.end();
        } else if (!authed) {
          send("-ERR not authenticated\r\n");
        } else if (verb === "STAT") {
          const size = messages.reduce((a, m) => a + Buffer.byteLength(m.raw), 0);
          send(`+OK ${messages.length} ${size}\r\n`);
        } else if (verb === "UIDL" && opts.floodOnUidl) {
          send("+OK\r\n");
          const junk = Buffer.alloc(256 * 1024, "x");
          const timer = setInterval(() => {
            if (socket.destroyed) clearInterval(timer);
            else socket.write(junk);
          }, 1);
          socket.on("close", () => clearInterval(timer));
        } else if (verb === "UIDL") {
          send("+OK\r\n" + messages.map((m, i) => `${i + 1} ${m.uidl}\r\n`).join("") + ".\r\n");
        } else if (verb === "LIST") {
          send("+OK\r\n" + messages.map((m, i) => `${i + 1} ${Buffer.byteLength(m.raw)}\r\n`).join("") + ".\r\n");
        } else if (verb === "RETR") {
          const m = msg(args[0]);
          if (!m) send("-ERR no such message\r\n");
          else {
            send("+OK\r\n");
            send(stuff(Buffer.from(m.raw)));
          }
        } else if (verb === "TOP") {
          const m = msg(args[0]);
          if (!m) send("-ERR no such message\r\n");
          else {
            const text = Buffer.from(m.raw).toString("latin1");
            const cut = text.search(/\r?\n\r?\n/);
            const head = cut >= 0 ? text.slice(0, cut) : text;
            send("+OK\r\n");
            send(stuff(Buffer.from(head + "\r\n", "latin1")));
          }
        } else {
          send("-ERR unknown command\r\n");
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    commands,
    get connections() {
      return connections;
    },
    setMessages(next) {
      messages = [...next];
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
