import fs from "node:fs";
import path from "node:path";
import { sanitizeIdentifier } from "../workspace/path-safety.js";

export class AgentFileLogger {
  private logDir: string;
  private streams = new Map<string, fs.WriteStream>();

  constructor(logsRoot: string) {
    this.logDir = logsRoot;
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  log(identifier: string, eventType: string, message: string): void {
    const stream = this.getStream(identifier);
    const timestamp = new Date().toISOString();
    stream.write(`[${timestamp}] [${eventType}] ${message}\n`);
  }

  /**
   * End and remove the stream for a completed issue.
   */
  endStream(identifier: string): void {
    const safe = sanitizeIdentifier(identifier);
    const stream = this.streams.get(safe);
    if (stream) {
      stream.end();
      this.streams.delete(safe);
    }
  }

  private getStream(identifier: string): fs.WriteStream {
    const safe = sanitizeIdentifier(identifier);
    let stream = this.streams.get(safe);
    if (!stream) {
      const filePath = path.join(this.logDir, `${safe}.log`);
      stream = fs.createWriteStream(filePath, { flags: "a" });
      this.streams.set(safe, stream);
    }
    return stream;
  }

  closeAll(): void {
    for (const stream of this.streams.values()) {
      stream.end();
    }
    this.streams.clear();
  }
}
