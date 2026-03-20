import fs from "node:fs";
import { EventEmitter } from "node:events";
import { loadWorkflow, type LoadedWorkflow } from "./workflow-loader.js";

export interface WorkflowWatcherEvents {
  reload: [workflow: LoadedWorkflow];
  error: [error: Error];
}

/**
 * Watches WORKFLOW.md for changes and emits reload events.
 * Debounces rapid changes (500ms).
 */
export class WorkflowWatcher extends EventEmitter<WorkflowWatcherEvents> {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 500;

  constructor(
    private filePath: string,
    private current: LoadedWorkflow,
  ) {
    super();
  }

  get workflow(): LoadedWorkflow {
    return this.current;
  }

  start(): void {
    this.watcher = fs.watch(this.filePath, () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.reload(), this.debounceMs);
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private reload(): void {
    try {
      const next = loadWorkflow(this.filePath);
      this.current = next;
      this.emit("reload", next);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }
}
