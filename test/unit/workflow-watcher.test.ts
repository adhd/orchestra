import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowWatcher } from "../../src/config/workflow-watcher.js";
import type { LoadedWorkflow } from "../../src/config/workflow-loader.js";

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-test-"));
  tmpDirs.push(dir);
  return dir;
}

function writeWorkflowFile(filePath: string, yaml: string, body: string) {
  fs.writeFileSync(filePath, `---\n${yaml}\n---\n${body}`);
}

function makeInitialWorkflow(): LoadedWorkflow {
  return {
    config: {
      tracker: {
        kind: "memory",
        endpoint: "https://api.linear.app/graphql",
        active_states: ["Todo"],
        terminal_states: ["Done"],
      },
      polling: { interval_ms: 30_000 },
      workspace: { root: "/tmp/ws" },
      hooks: { timeout_ms: 60_000 },
      agent: {
        max_concurrent_agents: 10,
        max_turns: 20,
        max_retries: 5,
        max_retry_backoff_ms: 300_000,
        max_concurrent_agents_by_state: {},
      },
      claude: {
        model: "claude-sonnet-4-6",
        stall_timeout_ms: 600_000,
        state_overrides: {},
      },
      server: { host: "127.0.0.1" },
      tool_policy: { allowed: ["*"], denied: [], state_overrides: {} },
    },
    promptTemplate: "initial prompt",
    rawConfig: {} as any,
  };
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("WorkflowWatcher", () => {
  it("emits reload event when file changes", async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "WORKFLOW.md");
    writeWorkflowFile(
      filePath,
      'tracker:\n  kind: memory\n  active_states: ["Todo"]\n  terminal_states: ["Done"]',
      "initial prompt",
    );

    const initial = makeInitialWorkflow();
    const watcher = new WorkflowWatcher(filePath, initial);

    const reloadPromise = new Promise<LoadedWorkflow>((resolve) => {
      watcher.on("reload", resolve);
    });

    watcher.start();

    // Modify the file
    await new Promise((r) => setTimeout(r, 100));
    writeWorkflowFile(
      filePath,
      'tracker:\n  kind: memory\n  active_states: ["Todo", "In Progress"]\n  terminal_states: ["Done"]',
      "updated prompt",
    );

    const reloaded = await Promise.race([
      reloadPromise,
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);

    watcher.stop();

    expect(reloaded).not.toBeNull();
    if (reloaded) {
      expect(reloaded.promptTemplate).toBe("updated prompt");
    }
  });

  it("emits error event on invalid YAML", async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "WORKFLOW.md");
    writeWorkflowFile(
      filePath,
      'tracker:\n  kind: memory\n  active_states: ["Todo"]\n  terminal_states: ["Done"]',
      "good prompt",
    );

    const initial = makeInitialWorkflow();
    const watcher = new WorkflowWatcher(filePath, initial);

    const errorPromise = new Promise<Error>((resolve) => {
      watcher.on("error", resolve);
    });

    watcher.start();

    // Write invalid config (polling interval below minimum)
    await new Promise((r) => setTimeout(r, 100));
    writeWorkflowFile(
      filePath,
      "tracker:\n  kind: memory\npolling:\n  interval_ms: 1",
      "bad prompt",
    );

    const error = await Promise.race([
      errorPromise,
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);

    watcher.stop();

    expect(error).toBeInstanceOf(Error);
  });

  it("keeps current config on reload failure", async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "WORKFLOW.md");
    writeWorkflowFile(
      filePath,
      'tracker:\n  kind: memory\n  active_states: ["Todo"]\n  terminal_states: ["Done"]',
      "good prompt",
    );

    const initial = makeInitialWorkflow();
    const watcher = new WorkflowWatcher(filePath, initial);

    const errorPromise = new Promise<Error>((resolve) => {
      watcher.on("error", resolve);
    });

    watcher.start();

    // Write invalid content
    await new Promise((r) => setTimeout(r, 100));
    writeWorkflowFile(
      filePath,
      "tracker:\n  kind: memory\npolling:\n  interval_ms: 1",
      "bad",
    );

    await Promise.race([errorPromise, new Promise((r) => setTimeout(r, 3000))]);

    // Current workflow should still be the initial one
    expect(watcher.workflow.promptTemplate).toBe("initial prompt");

    watcher.stop();
  });

  it("stop() prevents further events", async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "WORKFLOW.md");
    writeWorkflowFile(
      filePath,
      'tracker:\n  kind: memory\n  active_states: ["Todo"]\n  terminal_states: ["Done"]',
      "prompt",
    );

    const initial = makeInitialWorkflow();
    const watcher = new WorkflowWatcher(filePath, initial);

    let reloadCount = 0;
    watcher.on("reload", () => {
      reloadCount++;
    });

    watcher.start();
    watcher.stop();

    // Modify file after stop
    await new Promise((r) => setTimeout(r, 100));
    writeWorkflowFile(
      filePath,
      'tracker:\n  kind: memory\n  active_states: ["Todo", "In Progress"]\n  terminal_states: ["Done"]',
      "changed after stop",
    );

    await new Promise((r) => setTimeout(r, 1500));

    expect(reloadCount).toBe(0);
  });

  it("debounces rapid changes", async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "WORKFLOW.md");
    writeWorkflowFile(
      filePath,
      'tracker:\n  kind: memory\n  active_states: ["Todo"]\n  terminal_states: ["Done"]',
      "initial",
    );

    const initial = makeInitialWorkflow();
    const watcher = new WorkflowWatcher(filePath, initial);

    let reloadCount = 0;
    watcher.on("reload", () => {
      reloadCount++;
    });

    watcher.start();

    // Rapid writes
    await new Promise((r) => setTimeout(r, 100));
    for (let i = 0; i < 5; i++) {
      writeWorkflowFile(
        filePath,
        'tracker:\n  kind: memory\n  active_states: ["Todo"]\n  terminal_states: ["Done"]',
        `prompt version ${i}`,
      );
    }

    // Wait for debounce (500ms) plus processing time
    await new Promise((r) => setTimeout(r, 2000));

    watcher.stop();

    // Due to debouncing, we should see fewer reloads than writes
    // Exact count depends on timing, but it should be significantly less than 5
    expect(reloadCount).toBeLessThanOrEqual(3);
    expect(reloadCount).toBeGreaterThanOrEqual(1);
  });

  it("workflow getter returns current config", () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, "WORKFLOW.md");
    writeWorkflowFile(
      filePath,
      'tracker:\n  kind: memory\n  active_states: ["Todo"]\n  terminal_states: ["Done"]',
      "prompt",
    );

    const initial = makeInitialWorkflow();
    const watcher = new WorkflowWatcher(filePath, initial);

    expect(watcher.workflow).toBe(initial);
    expect(watcher.workflow.promptTemplate).toBe("initial prompt");
  });
});
