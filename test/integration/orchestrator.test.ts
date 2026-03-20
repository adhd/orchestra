import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import type { TrackerClient, NormalizedIssue } from "../../src/types/index.js";
import type { WorkflowConfig } from "../../src/config/schema.js";
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock the agent runner to avoid spawning real Claude processes
vi.mock("../../src/agent/agent-runner.js", () => ({
  runAgentSession: vi.fn(
    async (params: {
      onEvent: (msg: unknown) => void;
      toolPolicy?: unknown;
      issueState?: string;
    }) => {
      // Simulate some events
      params.onEvent({
        type: "system",
        subtype: "init",
        session_id: "test-session-1",
      });
      params.onEvent({ type: "assistant", content: "Working on it..." });
      params.onEvent({
        type: "result",
        subtype: "success",
        session_id: "test-session-1",
        usage: { input_tokens: 1000, output_tokens: 500, cost_usd: 0.01 },
      });

      return {
        success: true,
        sessionId: "test-session-1",
        turnCount: 5,
        tokenUsage: { input: 1000, output: 500, cacheRead: 0, costUSD: 0.01 },
        hitTurnLimit: false,
      };
    },
  ),
}));

function makeIssue(id: string, identifier: string): NormalizedIssue {
  return {
    id,
    identifier,
    title: `Test issue ${identifier}`,
    description: "Test description",
    priority: 1,
    state: "Todo",
    labels: [],
    blocked_by: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    branch_name: null,
    url: null,
  };
}

function createMockTracker(issues: NormalizedIssue[]): TrackerClient {
  return {
    fetchCandidateIssues: vi.fn(async () => issues),
    fetchIssueStatesByIds: vi.fn(async (ids: string[]) => {
      const map = new Map<string, string>();
      for (const id of ids) {
        const issue = issues.find((i) => i.id === id);
        if (issue) map.set(id, issue.state);
      }
      return map;
    }),
  };
}

describe("Orchestrator integration", () => {
  let tmpDir: string;
  let logger: pino.Logger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-test-"));
    logger = pino({ level: "silent" });
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
    return {
      tracker: {
        kind: "linear" as const,
        endpoint: "https://api.linear.app/graphql",
        api_key: "test-key",
        active_states: ["Todo", "In Progress"],
        terminal_states: ["Done", "Canceled"],
      },
      polling: { interval_ms: 60_000 }, // long interval, we'll tick manually
      workspace: { root: tmpDir },
      hooks: {
        timeout_ms: 60_000,
      },
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
      },
      server: { host: "127.0.0.1" },
      tool_policy: {
        allowed: ["*"],
        denied: [],
        state_overrides: {},
      },
      ...overrides,
    };
  }

  it("picks up a candidate issue and runs it", async () => {
    const issues = [makeIssue("id-1", "PROJ-1")];
    const tracker = createMockTracker(issues);
    const config = makeConfig();

    const orch = new Orchestrator({
      config,
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger: pino({ level: "debug" }),
    });

    // Ensure workspace root exists (normally done by start())
    fs.mkdirSync(tmpDir, { recursive: true });

    // Run a single tick
    await orch.forceTick();

    // Wait for async worker to complete
    await new Promise((r) => setTimeout(r, 2000));

    // Tracker should have been called
    expect(tracker.fetchCandidateIssues).toHaveBeenCalledWith([
      "Todo",
      "In Progress",
    ]);

    // Issue should be completed (released)
    const stats = orch.getStats();
    expect(stats.released).toBe(1);

    await orch.stop();
  });

  it("respects concurrency limits", async () => {
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue(`id-${i}`, `PROJ-${i}`),
    );
    const tracker = createMockTracker(issues);
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 2,
        max_turns: 20,
        max_retries: 5,
        max_retry_backoff_ms: 300_000,
        max_concurrent_agents_by_state: {},
      },
    });

    const orch = new Orchestrator({
      config,
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    // Tick once — should dispatch at most 2
    await orch.forceTick();

    // Immediately check running count (before workers complete)
    const stats = orch.getStats();
    // Could be 0-2 depending on timing, but should not exceed 2
    expect(stats.running).toBeLessThanOrEqual(2);

    await orch.stop();
  });

  it("does not double-dispatch the same issue", async () => {
    const issues = [makeIssue("id-1", "PROJ-1")];
    const tracker = createMockTracker(issues);
    const config = makeConfig();

    const orch = new Orchestrator({
      config,
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    // Tick twice in quick succession
    await orch.forceTick();
    await orch.forceTick();

    // Wait for completion
    await new Promise((r) => setTimeout(r, 500));

    // Should have released once, not dispatched twice
    const stats = orch.getStats();
    expect(stats.released).toBe(1);

    await orch.stop();
  });

  it("skips dispatch when tracker fails", async () => {
    const tracker: TrackerClient = {
      fetchCandidateIssues: vi.fn(async () => {
        throw new Error("Network error");
      }),
      fetchIssueStatesByIds: vi.fn(async () => new Map()),
    };

    const config = makeConfig();
    const orch = new Orchestrator({
      config,
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    // Should not throw
    await orch.forceTick();

    const stats = orch.getStats();
    expect(stats.running).toBe(0);

    await orch.stop();
  });
});
