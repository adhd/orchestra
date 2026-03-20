import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentFileLogger } from "../../src/observability/agent-logger.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("AgentFileLogger", () => {
  let tmpDir: string;
  let logger: AgentFileLogger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-logger-test-"));
    logger = new AgentFileLogger(tmpDir);
  });

  afterEach(() => {
    logger.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates log directory on construction", () => {
    const nestedDir = path.join(tmpDir, "nested", "logs");
    const nestedLogger = new AgentFileLogger(nestedDir);
    expect(fs.existsSync(nestedDir)).toBe(true);
    nestedLogger.closeAll();
  });

  it("writes log entries to per-identifier files", async () => {
    logger.log("PROJ-1", "assistant", "Hello world");
    logger.closeAll();

    // Wait briefly for stream flush
    await new Promise((r) => setTimeout(r, 50));

    const logPath = path.join(tmpDir, "PROJ-1.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("[assistant]");
    expect(content).toContain("Hello world");
  });

  it("appends multiple entries to the same file", async () => {
    logger.log("PROJ-2", "system", "init");
    logger.log("PROJ-2", "assistant", "working");
    logger.log("PROJ-2", "result", "done");
    logger.closeAll();

    await new Promise((r) => setTimeout(r, 50));

    const content = fs.readFileSync(path.join(tmpDir, "PROJ-2.log"), "utf-8");
    expect(content).toContain("[system] init");
    expect(content).toContain("[assistant] working");
    expect(content).toContain("[result] done");
  });

  it("writes to separate files for different identifiers", async () => {
    logger.log("PROJ-A", "system", "a-msg");
    logger.log("PROJ-B", "system", "b-msg");
    logger.closeAll();

    await new Promise((r) => setTimeout(r, 50));

    expect(fs.existsSync(path.join(tmpDir, "PROJ-A.log"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "PROJ-B.log"))).toBe(true);

    const contentA = fs.readFileSync(path.join(tmpDir, "PROJ-A.log"), "utf-8");
    const contentB = fs.readFileSync(path.join(tmpDir, "PROJ-B.log"), "utf-8");
    expect(contentA).toContain("a-msg");
    expect(contentA).not.toContain("b-msg");
    expect(contentB).toContain("b-msg");
  });

  it("includes ISO timestamp in log entries", async () => {
    logger.log("PROJ-T", "test", "timestamped");
    logger.closeAll();

    await new Promise((r) => setTimeout(r, 50));

    const content = fs.readFileSync(path.join(tmpDir, "PROJ-T.log"), "utf-8");
    // ISO timestamp pattern: 2026-03-15T...
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
