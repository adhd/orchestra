import fs from "node:fs";
import path from "node:path";

export interface AuditEntry {
  timestamp: string;
  issueId: string;
  identifier: string;
  sessionId: string | null;
  eventType: string;
  toolName?: string;
  detail?: string;
}

export class AuditTrail {
  private stream: fs.WriteStream | null = null;

  constructor(private filePath: string) {}

  start(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
    // Suppress ENOENT errors that can occur if the directory is removed
    // before the stream fully flushes (e.g., during test cleanup).
    this.stream.on("error", () => {});
  }

  record(entry: AuditEntry): void {
    if (!this.stream) return;
    this.stream.write(JSON.stringify(entry) + "\n");
  }

  stop(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
