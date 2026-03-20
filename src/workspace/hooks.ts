import { exec } from "node:child_process";
import type { HooksConfig } from "../config/schema.js";

export type HookName =
  | "after_create"
  | "before_run"
  | "after_run"
  | "before_remove";

export interface HookResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Execute a workspace lifecycle hook if configured.
 * Returns null if the hook is not configured.
 */
export async function executeHook(
  hookName: HookName,
  hooks: HooksConfig,
  workspacePath: string,
): Promise<HookResult | null> {
  const command = hooks[hookName];
  if (!command) return null;

  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: workspacePath,
      timeout: hooks.timeout_ms,
      env: { ...process.env, WORKSPACE_PATH: workspacePath },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: string) => {
      stdout += data;
      // Truncate at 10KB
      if (stdout.length > 10_240)
        stdout = stdout.slice(0, 10_240) + "\n[truncated]";
    });

    child.stderr?.on("data", (data: string) => {
      stderr += data;
      if (stderr.length > 10_240)
        stderr = stderr.slice(0, 10_240) + "\n[truncated]";
    });

    child.on("close", (exitCode) => {
      resolve({
        success: exitCode === 0,
        stdout,
        stderr,
        exitCode,
      });
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        stdout,
        stderr: stderr + "\n" + err.message,
        exitCode: null,
      });
    });
  });
}
