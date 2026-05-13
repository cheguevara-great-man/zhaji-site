import net from "node:net";
import tls from "node:tls";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class Emailer {
  constructor(outboxDir, smtp = smtpConfigFromEnv()) {
    this.outboxDir = outboxDir;
    this.smtp = smtp;
  }

  async send({ to, subject, text }) {
    if (this.smtp) {
      await sendSmtp(this.smtp, { to, subject, text });
      return { mode: "smtp" };
    }

    await mkdir(this.outboxDir, { recursive: true });
    const safeTo = String(to).replace(/[^a-z0-9._-]+/gi, "_");
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeTo}.txt`;
    await writeFile(join(this.outboxDir, filename), `To: ${to}\nSubject: ${subject}\n\n${text}`, "utf8");
    return { mode: "outbox", filename };
  }
}

function smtpConfigFromEnv() {
  if (!process.env.SMTP_HOST) return null;
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: parseBoolean(process.env.SMTP_SECURE, process.env.SMTP_PORT === "465"),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER,
    rejectUnauthorized: !parseBoolean(process.env.SMTP_ALLOW_SELF_SIGNED, false)
  };
}

async function sendSmtp(config, message) {
  if (!config.from) throw new Error("SMTP_FROM or SMTP_USER is required.");
  const client = new SmtpClient(config);
  await client.connect();
  try {
    await client.expect(220);
    let ehlo = await client.command(`EHLO ${process.env.SMTP_HELO || "localhost"}`, 250);

    const canStartTls = ehlo.text.includes("STARTTLS");
    if (!config.secure && canStartTls) {
      await client.command("STARTTLS", 220);
      await client.upgrade();
      ehlo = await client.command(`EHLO ${process.env.SMTP_HELO || "localhost"}`, 250);
    }

    if (config.user || config.pass) {
      if (!config.secure && !canStartTls && !parseBoolean(process.env.SMTP_ALLOW_INSECURE, false)) {
        throw new Error("SMTP server does not support STARTTLS. Set SMTP_SECURE=true or SMTP_ALLOW_INSECURE=true.");
      }
      await client.command(`AUTH PLAIN ${Buffer.from(`\0${config.user}\0${config.pass}`).toString("base64")}`, 235);
    }

    await client.command(`MAIL FROM:<${addressOnly(config.from)}>`, 250);
    await client.command(`RCPT TO:<${addressOnly(message.to)}>`, [250, 251]);
    await client.command("DATA", 354);
    await client.writeData(formatMessage(config.from, message));
    await client.expect(250);
    await client.command("QUIT", 221);
  } finally {
    client.close();
  }
}

class SmtpClient {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.buffer = "";
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const options = {
        host: this.config.host,
        port: this.config.port,
        servername: this.config.host,
        rejectUnauthorized: this.config.rejectUnauthorized
      };
      this.socket = this.config.secure ? tls.connect(options, resolve) : net.connect(options, resolve);
      this.socket.setEncoding("utf8");
      this.socket.on("data", (chunk) => this.onData(chunk));
      this.socket.on("error", reject);
    });
  }

  upgrade() {
    this.socket.removeAllListeners("data");
    this.socket = tls.connect({
      socket: this.socket,
      servername: this.config.host,
      rejectUnauthorized: this.config.rejectUnauthorized
    });
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => this.onData(chunk));
    return new Promise((resolve, reject) => {
      this.socket.once("secureConnect", resolve);
      this.socket.once("error", reject);
    });
  }

  command(command, expected) {
    this.socket.write(`${command}\r\n`);
    return this.expect(expected);
  }

  writeData(data) {
    this.socket.write(`${data}\r\n.\r\n`);
  }

  expect(expected) {
    const codes = Array.isArray(expected) ? expected : [expected];
    return this.readResponse().then((response) => {
      if (!codes.includes(response.code)) {
        throw new Error(`SMTP expected ${codes.join("/")} but got ${response.code}: ${response.text}`);
      }
      return response;
    });
  }

  readResponse() {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.flush();
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    this.flush();
  }

  flush() {
    if (!this.waiters.length) return;
    const lines = this.buffer.split(/\r?\n/);
    if (lines.length < 2) return;

    const completeIndex = lines.findIndex((line) => /^\d{3} /.test(line));
    if (completeIndex === -1) return;

    const responseLines = lines.slice(0, completeIndex + 1);
    this.buffer = lines.slice(completeIndex + 1).join("\n");
    const code = Number(responseLines.at(-1).slice(0, 3));
    this.waiters.shift()({ code, text: responseLines.join("\n") });
  }

  close() {
    this.socket?.end();
  }
}

function formatMessage(from, { to, subject, text }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ];
  return `${headers.join("\r\n")}\r\n\r\n${dotEscape(text)}`;
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), "utf8").toString("base64")}?=`;
}

function dotEscape(value) {
  return String(value).replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function addressOnly(value) {
  const match = /<([^>]+)>/.exec(String(value));
  return (match ? match[1] : String(value)).trim();
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}
