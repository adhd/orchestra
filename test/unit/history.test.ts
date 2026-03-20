import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  HistoryLog,
  type HistoryEntry,
} from "../../src/observability/history.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    issueId: "issue-1",
    identifier: "PROJ-1",
    title: "Test issue",
    status: "completed",
    attempts: 1,
    totalCostUSD: 0.05,
    totalTurns: 10,
    sessionId: "sess-1",
    error: null,
    durationMs: 30_000,
    ...overrides,
  };
}

describe("HistoryLog", () => {
  let tmpDir: string;
  let historyPath: string;
  let log: HistoryLog;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-test-"));
    historyPath = path.join(tmpDir, "history.jsonl");
    log = new HistoryLog(historyPath);
  });

  afterEach(async () => {
    log.stop();
    await new Promise((r) => setTimeout(r, 50));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records entries as JSONL", async () => {
    log.start();
    log.record(makeEntry({ identifier: "PROJ-1" }));
    log.record(makeEntry({ identifier: "PROJ-2" }));
    log.stop();

    await new Promise((r) => setTimeout(r, 100));

    const lines = fs.readFileSync(historyPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]);
    expect(first.identifier).toBe("PROJ-1");

    const second = JSON.parse(lines[1]);
    expect(second.identifier).toBe("PROJ-2");
  });

  it("getAll returns all entries", () => {
    log.start();
    log.record(makeEntry({ identifier: "A" }));
    log.record(makeEntry({ identifier: "B" }));
    log.record(makeEntry({ identifier: "C" }));

    const all = log.getAll();
    expect(all.length).toBe(3);
    expect(all[0].identifier).toBe("A");
    expect(all[2].identifier).toBe("C");
  });

  it("getRecent limits results", () => {
    log.start();
    for (let i = 0; i < 10; i++) {
      log.record(makeEntry({ identifier: `PROJ-${i}` }));
    }

    const recent = log.getRecent(3);
    expect(recent.length).toBe(3);
    expect(recent[0].identifier).toBe("PROJ-7");
    expect(recent[1].identifier).toBe("PROJ-8");
    expect(recent[2].identifier).toBe("PROJ-9");
  });

  it("loads existing entries on start", async () => {
    // Write some entries manually
    const entry1 = JSON.stringify(makeEntry({ identifier: "EXISTING-1" }));
    const entry2 = JSON.stringify(makeEntry({ identifier: "EXISTING-2" }));
    fs.writeFileSync(historyPath, entry1 + "\n" + entry2 + "\n");

    log.start();

    const all = log.getAll();
    expect(all.length).toBe(2);
    expect(all[0].identifier).toBe("EXISTING-1");
    expect(all[1].identifier).toBe("EXISTING-2");

    // New entries append correctly
    log.record(makeEntry({ identifier: "NEW-1" }));
    expect(log.getAll().length).toBe(3);
  });

  it("handles empty file", () => {
    fs.writeFileSync(historyPath, "");
    log.start();
    expect(log.getAll()).toEqual([]);
  });

  it("handles missing file", () => {
    // historyPath does not exist yet
    expect(fs.existsSync(historyPath)).toBe(false);
    log.start();
    expect(log.getAll()).toEqual([]);
  });

  it("handles malformed lines gracefully", () => {
    fs.writeFileSync(
      historyPath,
      JSON.stringify(makeEntry({ identifier: "GOOD" })) +
        "\n" +
        "not-valid-json\n" +
        JSON.stringify(makeEntry({ identifier: "ALSO-GOOD" })) +
        "\n",
    );

    log.start();
    const all = log.getAll();
    expect(all.length).toBe(2);
    expect(all[0].identifier).toBe("GOOD");
    expect(all[1].identifier).toBe("ALSO-GOOD");
  });

  it("creates directory if missing", () => {
    const nestedPath = path.join(tmpDir, "nested", "deep", "history.jsonl");
    const nestedLog = new HistoryLog(nestedPath);
    nestedLog.start();
    expect(fs.existsSync(path.dirname(nestedPath))).toBe(true);
    nestedLog.stop();
  });

  it("stop is idempotent", () => {
    log.start();
    log.stop();
    expect(() => log.stop()).not.toThrow();
  });

  it("record without start still tracks in memory", () => {
    // Don't call start — record should still add to in-memory array
    log.record(makeEntry({ identifier: "MEM-ONLY" }));
    expect(log.getAll().length).toBe(1);
    expect(log.getAll()[0].identifier).toBe("MEM-ONLY");
  });
});
