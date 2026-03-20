import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceManager } from "../../src/workspace/workspace-manager.js";
import type { HooksConfig } from "../../src/config/schema.js";

const NO_HOOKS: HooksConfig = { timeout_ms: 5000 };

let tmpDirs: string[] = [];

function makeTmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-mgr-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
  vi.restoreAllMocks();
});

describe("WorkspaceManager", () => {
  it("ensureRoot creates directory", () => {
    const root = path.join(makeTmpRoot(), "nested", "root");
    const mgr = new WorkspaceManager(root, NO_HOOKS);
    expect(fs.existsSync(root)).toBe(false);

    mgr.ensureRoot();

    expect(fs.existsSync(root)).toBe(true);
    expect(fs.statSync(root).isDirectory()).toBe(true);
  });

  it("getOrCreate creates a new workspace", async () => {
    const root = makeTmpRoot();
    const mgr = new WorkspaceManager(root, NO_HOOKS);

    const result = await mgr.getOrCreate("PROJ-1");

    expect(result.created).toBe(true);
    expect(fs.existsSync(result.path)).toBe(true);
    expect(result.path).toContain("PROJ-1");
  });

  it("getOrCreate reuses an existing workspace", async () => {
    const root = makeTmpRoot();
    const mgr = new WorkspaceManager(root, NO_HOOKS);

    const first = await mgr.getOrCreate("PROJ-2");
    const second = await mgr.getOrCreate("PROJ-2");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.path).toBe(second.path);
  });

  it("remove deletes workspace directory", async () => {
    const root = makeTmpRoot();
    const mgr = new WorkspaceManager(root, NO_HOOKS);

    const { path: wsPath } = await mgr.getOrCreate("PROJ-3");
    expect(fs.existsSync(wsPath)).toBe(true);

    await mgr.remove("PROJ-3");
    expect(fs.existsSync(wsPath)).toBe(false);
  });

  it("listExisting returns directory names", async () => {
    const root = makeTmpRoot();
    const mgr = new WorkspaceManager(root, NO_HOOKS);

    await mgr.getOrCreate("PROJ-A");
    await mgr.getOrCreate("PROJ-B");
    // Create a file (not a directory) to verify it gets filtered out
    fs.writeFileSync(path.join(root, "some-file.txt"), "hi");

    const listing = mgr.listExisting();
    expect(listing).toContain("PROJ-A");
    expect(listing).toContain("PROJ-B");
    expect(listing).not.toContain("some-file.txt");
  });

  it("after_create hook failure cleans up workspace", async () => {
    const root = makeTmpRoot();
    const hooks: HooksConfig = {
      after_create: "exit 1",
      timeout_ms: 5000,
    };
    const mgr = new WorkspaceManager(root, hooks);

    await expect(mgr.getOrCreate("PROJ-FAIL")).rejects.toThrow(
      /after_create hook failed/,
    );

    // Workspace directory should have been removed
    const listing = mgr.listExisting();
    expect(listing).not.toContain("PROJ-FAIL");
  });
});
