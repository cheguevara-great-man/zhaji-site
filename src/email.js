import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class Emailer {
  constructor(outboxDir) {
    this.outboxDir = outboxDir;
  }

  async send({ to, subject, text }) {
    await mkdir(this.outboxDir, { recursive: true });
    const safeTo = String(to).replace(/[^a-z0-9._-]+/gi, "_");
    const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeTo}.txt`;
    await writeFile(join(this.outboxDir, filename), `To: ${to}\nSubject: ${subject}\n\n${text}`, "utf8");
    return { mode: "outbox", filename };
  }
}
