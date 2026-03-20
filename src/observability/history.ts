import fs from "node:fs";
import path from "node:path";

export interface HistoryEntry {
  timestamp: string;
  issueId: string;
  identifier: string;
  title: string;
  status: "completed" | "failed" | "max_retries" | "circuit_breaker";
  attempts: number;
  totalCostUSD: number;
  totalTurns: number;
  sessionId: string | null;
  error: string | null;
  durationMs: number;
}

export class HistoryLog {
  private stream: fs.WriteStream | null = null;
  private entries: HistoryEntry[] = []; // also keep in memory for API

  constructor(private filePath: string) {}

  start(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Load existing entries from file
    if (fs.existsSync(this.filePath)) {
      const lines = fs
        .readFileSync(this.filePath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const line of lines) {
        try {
          this.entries.push(JSON.parse(line));
        } catch {
          // skip malformed lines
        }
      }
    }

    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
  }

  record(entry: HistoryEntry): void {
    this.entries.push(entry);
    if (this.stream) {
      this.stream.write(JSON.stringify(entry) + "\n");
    }
  }

  getAll(): HistoryEntry[] {
    return this.entries;
  }

  getRecent(limit: number = 50): HistoryEntry[] {
    return this.entries.slice(-limit);
  }

  stop(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
