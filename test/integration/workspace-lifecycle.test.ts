import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkspaceManager } from "../../src/workspace/workspace-manager.js";
import type { HooksConfig } from "../../src/config/schema.js";

let tmpDirs: string[] = [];

function makeTmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-lifecycle-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("Workspace lifecycle integration", () => {
  it("create workspace, run hooks, verify files exist", async () => {
    const root = makeTmpRoot();
    const hooks: HooksConfig = {
      after_create: 'echo "setup done" > setup.log',
      before_run: 'echo "pre-run" >> run.log',
      after_run: 'echo "post-run" >> run.log',
      timeout_ms: 5000,
    };
    const mgr = new WorkspaceManager(root, hooks);

    const { path: wsPath, created } = await mgr.getOrCreate("PROJ-1");
    expect(created).toBe(true);
    expect(fs.existsSync(wsPath)).toBe(true);

    // after_create hook should have created setup.log
    const setupLog = path.join(wsPath, "setup.log");
    expect(fs.existsSync(setupLog)).toBe(true);
    expect(fs.readFileSync(setupLog, "utf-8")).toContain("setup done");

    // Run before_run and after_run hooks
    await mgr.beforeRun("PROJ-1");
    await mgr.afterRun("PROJ-1");

    const runLog = path.join(wsPath, "run.log");
    expect(fs.existsSync(runLog)).toBe(true);
    const runLogContent = fs.readFileSync(runLog, "utf-8");
    expect(runLogContent).toContain("pre-run");
    expect(runLogContent).toContain("post-run");
  });

  it("after_create failure cleans up directory", async () => {
    const root = makeTmpRoot();
    const hooks: HooksConfig = {
      after_create: "exit 1",
      timeout_ms: 5000,
    };
    const mgr = new WorkspaceManager(root, hooks);

    await expect(mgr.getOrCreate("PROJ-FAIL")).rejects.toThrow(
      /after_create hook failed/,
    );

    // Directory should be cleaned up
    const wsPath = mgr.getPath("PROJ-FAIL");
    expect(fs.existsSync(wsPath)).toBe(false);
    expect(mgr.listExisting()).not.toContain("PROJ-FAIL");
  });

  it("before_run failure throws but does not delete workspace", async () => {
    const root = makeTmpRoot();
    const hooks: HooksConfig = {
      before_run: "exit 1",
      timeout_ms: 5000,
    };
    const mgr = new WorkspaceManager(root, hooks);

    const { path: wsPath } = await mgr.getOrCreate("PROJ-BR");
    expect(fs.existsSync(wsPath)).toBe(true);

    await expect(mgr.beforeRun("PROJ-BR")).rejects.toThrow(
      /before_run hook failed/,
    );

    // Workspace should still exist
    expect(fs.existsSync(wsPath)).toBe(true);
  });

  it("after_run failure is ignored (non-fatal)", async () => {
    const root = makeTmpRoot();
    const hooks: HooksConfig = {
      after_run: "exit 1",
      timeout_ms: 5000,
    };
    const mgr = new WorkspaceManager(root, hooks);

    const { path: wsPath } = await mgr.getOrCreate("PROJ-AR");
    expect(fs.existsSync(wsPath)).toBe(true);

    // after_run should not throw even if hook fails
    await expect(mgr.afterRun("PROJ-AR")).resolves.not.toThrow();

    // Workspace should still exist
    expect(fs.existsSync(wsPath)).toBe(true);
  });

  it("remove workspace with before_remove hook", async () => {
    const root = makeTmpRoot();
    const hooks: HooksConfig = {
      before_remove: 'echo "cleaning up"',
      timeout_ms: 5000,
    };
    const mgr = new WorkspaceManager(root, hooks);

    const { path: wsPath } = await mgr.getOrCreate("PROJ-RM");
    expect(fs.existsSync(wsPath)).toBe(true);

    await mgr.remove("PROJ-RM");
    expect(fs.existsSync(wsPath)).toBe(false);
  });

  it("remove non-existent workspace is a no-op", async () => {
    const root = makeTmpRoot();
    const mgr = new WorkspaceManager(root, { timeout_ms: 5000 });

    // Should not throw
    await expect(mgr.remove("PROJ-NOPE")).resolves.not.toThrow();
  });

  it("workspace getPath returns consistent path", async () => {
    const root = makeTmpRoot();
    const mgr = new WorkspaceManager(root, { timeout_ms: 5000 });

    const p1 = mgr.getPath("PROJ-X");
    const p2 = mgr.getPath("PROJ-X");
    expect(p1).toBe(p2);
    expect(p1).toContain("PROJ-X");
  });

  it("full lifecycle: create, hooks, remove, verify clean", async () => {
    const root = makeTmpRoot();
    const hooks: HooksConfig = {
      after_create: "touch .initialized",
      before_run: "touch .pre-run",
      after_run: "touch .post-run",
      before_remove: "touch .pre-remove",
      timeout_ms: 5000,
    };
    const mgr = new WorkspaceManager(root, hooks);

    // Create
    const { path: wsPath } = await mgr.getOrCreate("PROJ-FULL");
    expect(fs.existsSync(path.join(wsPath, ".initialized"))).toBe(true);

    // Before run
    await mgr.beforeRun("PROJ-FULL");
    expect(fs.existsSync(path.join(wsPath, ".pre-run"))).toBe(true);

    // After run
    await mgr.afterRun("PROJ-FULL");
    expect(fs.existsSync(path.join(wsPath, ".post-run"))).toBe(true);

    // Remove
    await mgr.remove("PROJ-FULL");
    expect(fs.existsSync(wsPath)).toBe(false);
    expect(mgr.listExisting()).not.toContain("PROJ-FULL");
  });

  it("second getOrCreate does not re-run after_create hook", async () => {
    const root = makeTmpRoot();
    let hookRunCount = 0;
    // We use a file to track how many times the hook ran
    const hooks: HooksConfig = {
      after_create:
        "count=$(cat .hook-count 2>/dev/null || echo 0); echo $((count + 1)) > .hook-count",
      timeout_ms: 5000,
    };
    const mgr = new WorkspaceManager(root, hooks);

    const first = await mgr.getOrCreate("PROJ-REUSE");
    const hookCountFile = path.join(first.path, ".hook-count");

    const second = await mgr.getOrCreate("PROJ-REUSE");

    // Hook should have run only once (on creation)
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const content = fs.readFileSync(hookCountFile, "utf-8").trim();
    expect(content).toBe("1");
  });

  it("multiple workspaces coexist independently", async () => {
    const root = makeTmpRoot();
    const hooks: HooksConfig = {
      after_create: 'echo "$WORKSPACE_PATH" > ws-id.txt',
      timeout_ms: 5000,
    };
    const mgr = new WorkspaceManager(root, hooks);

    const ws1 = await mgr.getOrCreate("PROJ-A");
    const ws2 = await mgr.getOrCreate("PROJ-B");
    const ws3 = await mgr.getOrCreate("PROJ-C");

    expect(ws1.path).not.toBe(ws2.path);
    expect(ws2.path).not.toBe(ws3.path);

    // Each workspace should have its own ws-id.txt
    const id1 = fs
      .readFileSync(path.join(ws1.path, "ws-id.txt"), "utf-8")
      .trim();
    const id2 = fs
      .readFileSync(path.join(ws2.path, "ws-id.txt"), "utf-8")
      .trim();
    expect(id1).not.toBe(id2);

    expect(mgr.listExisting()).toHaveLength(3);
  });
});
