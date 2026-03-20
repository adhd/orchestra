import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { executeHook } from "../../src/workspace/hooks.js";
import type { HooksConfig } from "../../src/config/schema.js";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("executeHook", () => {
  it("successful hook execution returns exit code 0", async () => {
    const dir = makeTmpDir();
    const hooks: HooksConfig = {
      after_create: 'echo "hello from hook"',
      timeout_ms: 5000,
    };

    const result = await executeHook("after_create", hooks, dir);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.exitCode).toBe(0);
    expect(result!.stdout).toContain("hello from hook");
    expect(result!.stderr).toBe("");
  });

  it("failed hook returns non-zero exit code and stderr", async () => {
    const dir = makeTmpDir();
    const hooks: HooksConfig = {
      after_create: 'echo "error msg" >&2 && exit 1',
      timeout_ms: 5000,
    };

    const result = await executeHook("after_create", hooks, dir);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.exitCode).toBe(1);
    expect(result!.stderr).toContain("error msg");
  });

  it("hook timeout kills the process", async () => {
    const dir = makeTmpDir();
    const hooks: HooksConfig = {
      before_run: "sleep 30",
      timeout_ms: 200,
    };

    const result = await executeHook("before_run", hooks, dir);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    // Killed processes have null exit code or non-zero
    expect(result!.exitCode).not.toBe(0);
  });

  it("missing hook (not configured) returns null", async () => {
    const dir = makeTmpDir();
    const hooks: HooksConfig = {
      timeout_ms: 5000,
      // no hooks configured
    };

    const resultCreate = await executeHook("after_create", hooks, dir);
    const resultBeforeRun = await executeHook("before_run", hooks, dir);
    const resultAfterRun = await executeHook("after_run", hooks, dir);
    const resultBeforeRemove = await executeHook("before_remove", hooks, dir);

    expect(resultCreate).toBeNull();
    expect(resultBeforeRun).toBeNull();
    expect(resultAfterRun).toBeNull();
    expect(resultBeforeRemove).toBeNull();
  });

  it("WORKSPACE_PATH env var is set to workspace path", async () => {
    const dir = makeTmpDir();
    const hooks: HooksConfig = {
      after_create: 'echo "$WORKSPACE_PATH"',
      timeout_ms: 5000,
    };

    const result = await executeHook("after_create", hooks, dir);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.stdout.trim()).toBe(dir);
  });

  it("stdout truncation at 10KB", async () => {
    const dir = makeTmpDir();
    // Generate output larger than 10KB
    // Each 'yes' iteration outputs ~2 bytes, we want > 10240 bytes
    const hooks: HooksConfig = {
      after_create:
        "python3 -c \"print('x' * 20000)\" 2>/dev/null || node -e \"process.stdout.write('x'.repeat(20000))\"",
      timeout_ms: 5000,
    };

    const result = await executeHook("after_create", hooks, dir);

    expect(result).not.toBeNull();
    if (result && result.success) {
      // Output should be truncated
      expect(result.stdout.length).toBeLessThanOrEqual(10_240 + 20);
      if (result.stdout.length > 10_240) {
        expect(result.stdout).toContain("[truncated]");
      }
    }
  });

  it("hook runs in the workspace directory (cwd)", async () => {
    const dir = makeTmpDir();
    const hooks: HooksConfig = {
      after_create: "pwd",
      timeout_ms: 5000,
    };

    const result = await executeHook("after_create", hooks, dir);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    // The pwd output should be the workspace directory
    // On macOS, /tmp may resolve to /private/tmp
    expect(
      result!.stdout.trim() === dir ||
        result!.stdout.trim() === fs.realpathSync(dir),
    ).toBe(true);
  });

  it("each hook type can be independently configured", async () => {
    const dir = makeTmpDir();
    const hooks: HooksConfig = {
      after_create: 'echo "create"',
      before_run: 'echo "before"',
      after_run: 'echo "after"',
      before_remove: 'echo "remove"',
      timeout_ms: 5000,
    };

    const r1 = await executeHook("after_create", hooks, dir);
    const r2 = await executeHook("before_run", hooks, dir);
    const r3 = await executeHook("after_run", hooks, dir);
    const r4 = await executeHook("before_remove", hooks, dir);

    expect(r1!.stdout).toContain("create");
    expect(r2!.stdout).toContain("before");
    expect(r3!.stdout).toContain("after");
    expect(r4!.stdout).toContain("remove");
  });

  it("hook with exit code 2 returns exitCode 2", async () => {
    const dir = makeTmpDir();
    const hooks: HooksConfig = {
      after_create: "exit 2",
      timeout_ms: 5000,
    };

    const result = await executeHook("after_create", hooks, dir);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.exitCode).toBe(2);
  });

  it("hook stderr is captured independently from stdout", async () => {
    const dir = makeTmpDir();
    const hooks: HooksConfig = {
      after_create: 'echo "out" && echo "err" >&2',
      timeout_ms: 5000,
    };

    const result = await executeHook("after_create", hooks, dir);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.stdout).toContain("out");
    expect(result!.stderr).toContain("err");
  });
});
