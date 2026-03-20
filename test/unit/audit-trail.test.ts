import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AuditTrail,
  type AuditEntry,
} from "../../src/observability/audit-trail.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("AuditTrail", () => {
  let tmpDir: string;
  let trail: AuditTrail;
  let auditPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-trail-test-"));
    auditPath = path.join(tmpDir, "audit.jsonl");
    trail = new AuditTrail(auditPath);
  });

  afterEach(async () => {
    trail.stop();
    // Allow stream to fully close before removing temp directory
    await new Promise((r) => setTimeout(r, 50));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records entries as JSONL", async () => {
    trail.start();

    const entry: AuditEntry = {
      timestamp: "2026-03-15T10:00:00.000Z",
      issueId: "issue-1",
      identifier: "PROJ-1",
      sessionId: "sess-abc",
      eventType: "tool_use",
      toolName: "Read",
    };
    trail.record(entry);
    trail.stop();

    // Wait for stream flush
    await new Promise((r) => setTimeout(r, 100));

    const content = fs.readFileSync(auditPath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.issueId).toBe("issue-1");
    expect(parsed.identifier).toBe("PROJ-1");
    expect(parsed.toolName).toBe("Read");
    expect(parsed.eventType).toBe("tool_use");
    expect(parsed.sessionId).toBe("sess-abc");
  });

  it("creates directory if missing", () => {
    const nestedPath = path.join(tmpDir, "nested", "deep", "audit.jsonl");
    const nestedTrail = new AuditTrail(nestedPath);
    nestedTrail.start();

    expect(fs.existsSync(path.dirname(nestedPath))).toBe(true);
    nestedTrail.stop();
  });

  it("multiple entries append correctly", async () => {
    trail.start();

    trail.record({
      timestamp: "2026-03-15T10:00:00.000Z",
      issueId: "issue-1",
      identifier: "PROJ-1",
      sessionId: null,
      eventType: "tool_use",
      toolName: "Read",
    });
    trail.record({
      timestamp: "2026-03-15T10:00:01.000Z",
      issueId: "issue-1",
      identifier: "PROJ-1",
      sessionId: "sess-1",
      eventType: "tool_use",
      toolName: "Write",
    });
    trail.record({
      timestamp: "2026-03-15T10:00:02.000Z",
      issueId: "issue-2",
      identifier: "PROJ-2",
      sessionId: "sess-2",
      eventType: "tool_use",
      toolName: "Bash",
      detail: "ran git status",
    });
    trail.stop();

    await new Promise((r) => setTimeout(r, 100));

    const lines = fs.readFileSync(auditPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);

    const first = JSON.parse(lines[0]);
    expect(first.toolName).toBe("Read");
    expect(first.sessionId).toBeNull();

    const second = JSON.parse(lines[1]);
    expect(second.toolName).toBe("Write");
    expect(second.sessionId).toBe("sess-1");

    const third = JSON.parse(lines[2]);
    expect(third.toolName).toBe("Bash");
    expect(third.identifier).toBe("PROJ-2");
    expect(third.detail).toBe("ran git status");
  });

  it("stop() flushes and closes the stream", async () => {
    trail.start();

    trail.record({
      timestamp: "2026-03-15T10:00:00.000Z",
      issueId: "issue-1",
      identifier: "PROJ-1",
      sessionId: null,
      eventType: "tool_use",
      toolName: "Read",
    });

    trail.stop();

    await new Promise((r) => setTimeout(r, 100));

    // File should exist and have content
    expect(fs.existsSync(auditPath)).toBe(true);
    const content = fs.readFileSync(auditPath, "utf-8").trim();
    expect(content.length).toBeGreaterThan(0);

    // After stop, further records should be silently ignored
    trail.record({
      timestamp: "2026-03-15T10:00:01.000Z",
      issueId: "issue-2",
      identifier: "PROJ-2",
      sessionId: null,
      eventType: "tool_use",
      toolName: "Write",
    });

    await new Promise((r) => setTimeout(r, 50));

    // Should still be only one line
    const lines = fs.readFileSync(auditPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
  });

  it("stop() is idempotent", () => {
    trail.start();
    trail.stop();
    // Should not throw
    trail.stop();
  });

  it("record() is a no-op before start()", () => {
    // Do not call start
    trail.record({
      timestamp: "2026-03-15T10:00:00.000Z",
      issueId: "issue-1",
      identifier: "PROJ-1",
      sessionId: null,
      eventType: "tool_use",
      toolName: "Read",
    });

    // File should not exist since start was never called
    expect(fs.existsSync(auditPath)).toBe(false);
  });
});
