import fs from "node:fs";
import path from "node:path";

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

  private getStream(identifier: string): fs.WriteStream {
    let stream = this.streams.get(identifier);
    if (!stream) {
      const filePath = path.join(this.logDir, `${identifier}.log`);
      stream = fs.createWriteStream(filePath, { flags: "a" });
      this.streams.set(identifier, stream);
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
