import fs from "node:fs";
import path from "node:path";
import { buildWorkspacePath } from "./path-safety.js";
import { executeHook, type HookName } from "./hooks.js";
import type { HooksConfig } from "../config/schema.js";

export class WorkspaceManager {
  constructor(
    private root: string,
    private hooks: HooksConfig,
  ) {}

  /**
   * Ensure the workspace root directory exists.
   */
  ensureRoot(): void {
    fs.mkdirSync(this.root, { recursive: true });
  }

  /**
   * Get or create a workspace for an issue.
   * Returns the workspace path.
   * Runs after_create hook only on first creation.
   */
  async getOrCreate(
    identifier: string,
  ): Promise<{ path: string; created: boolean }> {
    const wsPath = buildWorkspacePath(this.root, identifier);
    const existed = fs.existsSync(wsPath);

    if (!existed) {
      fs.mkdirSync(wsPath, { recursive: true });
      const hookResult = await executeHook("after_create", this.hooks, wsPath);
      if (hookResult && !hookResult.success) {
        // Cleanup failed workspace
        fs.rmSync(wsPath, { recursive: true, force: true });
        throw new Error(
          `after_create hook failed for ${identifier}: ${hookResult.stderr}`,
        );
      }
    }

    return { path: wsPath, created: !existed };
  }

  /**
   * Run before_run hook for a workspace.
   */
  async beforeRun(identifier: string): Promise<void> {
    const wsPath = buildWorkspacePath(this.root, identifier);
    const result = await executeHook("before_run", this.hooks, wsPath);
    if (result && !result.success) {
      throw new Error(
        `before_run hook failed for ${identifier}: ${result.stderr}`,
      );
    }
  }

  /**
   * Run after_run hook for a workspace.
   */
  async afterRun(identifier: string): Promise<void> {
    const wsPath = buildWorkspacePath(this.root, identifier);
    // after_run failures are logged but not fatal
    await executeHook("after_run", this.hooks, wsPath);
  }

  /**
   * Remove a workspace directory.
   * Runs before_remove hook first.
   */
  async remove(identifier: string): Promise<void> {
    const wsPath = buildWorkspacePath(this.root, identifier);
    if (!fs.existsSync(wsPath)) return;

    // before_remove failures are logged, cleanup proceeds
    await executeHook("before_remove", this.hooks, wsPath);
    fs.rmSync(wsPath, { recursive: true, force: true });
  }

  /**
   * List all workspace identifiers currently on disk.
   */
  listExisting(): string[] {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root).filter((entry) => {
      const full = path.join(this.root, entry);
      return fs.statSync(full).isDirectory();
    });
  }

  getPath(identifier: string): string {
    return buildWorkspacePath(this.root, identifier);
  }
}
