import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import type { TrackerClient, NormalizedIssue } from "../../src/types/index.js";
import type { WorkflowConfig } from "../../src/config/schema.js";
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock the agent runner
const mockRunAgentSession = vi.fn();
vi.mock("../../src/agent/agent-runner.js", () => ({
  runAgentSession: (...args: unknown[]) => mockRunAgentSession(...args),
}));

function makeIssue(
  id: string,
  identifier: string,
  overrides: Partial<NormalizedIssue> = {},
): NormalizedIssue {
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
    ...overrides,
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

function defaultAgentResult() {
  return {
    success: true,
    sessionId: "test-session-1",
    turnCount: 5,
    tokenUsage: { input: 1000, output: 500, cacheRead: 0, costUSD: 0.01 },
    hitTurnLimit: false,
  };
}

describe("Orchestrator edge cases", () => {
  let tmpDir: string;
  const logger = pino({ level: "silent" });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-edge-test-"));
    mockRunAgentSession.mockReset();
    mockRunAgentSession.mockImplementation(
      async (params: { onEvent: (msg: unknown) => void }) => {
        params.onEvent({
          type: "system",
          subtype: "init",
          session_id: "test-session-1",
        });
        params.onEvent({ type: "assistant", content: "Working..." });
        params.onEvent({
          type: "result",
          subtype: "success",
          session_id: "test-session-1",
          usage: { input_tokens: 1000, output_tokens: 500, cost_usd: 0.01 },
        });
        return defaultAgentResult();
      },
    );
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
    return {
      tracker: {
        kind: "memory" as const,
        endpoint: "https://api.linear.app/graphql",
        active_states: ["Todo", "In Progress"],
        terminal_states: ["Done", "Canceled"],
      },
      polling: { interval_ms: 600_000 },
      workspace: { root: tmpDir },
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
      ...overrides,
    };
  }

  it("issue with non-terminal blockers is skipped", async () => {
    const blocked = makeIssue("id-blocked", "PROJ-BLOCKED", {
      blocked_by: ["PROJ-OTHER"],
    });
    const tracker = createMockTracker([blocked]);
    const orch = new Orchestrator({
      config: makeConfig(),
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    await orch.forceTick();
    await new Promise((r) => setTimeout(r, 200));

    expect(mockRunAgentSession).not.toHaveBeenCalled();
    expect(orch.getStats().running).toBe(0);
    await orch.stop();
  });

  it("max retries reached releases the issue", async () => {
    const issues = [makeIssue("id-fail", "PROJ-FAIL")];
    const tracker = createMockTracker(issues);
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 10,
        max_turns: 20,
        max_retries: 1,
        max_retry_backoff_ms: 100,
        max_concurrent_agents_by_state: {},
      },
    });

    mockRunAgentSession.mockImplementation(
      async (params: { onEvent: (msg: unknown) => void }) => {
        params.onEvent({
          type: "system",
          subtype: "init",
          session_id: "sess-fail",
        });
        params.onEvent({
          type: "result",
          subtype: "error",
          session_id: "sess-fail",
        });
        return {
          success: false,
          sessionId: "sess-fail",
          turnCount: 1,
          tokenUsage: { input: 100, output: 50, cacheRead: 0, costUSD: 0.001 },
          error: "Agent failed",
          hitTurnLimit: false,
        };
      },
    );

    const orch = new Orchestrator({
      config,
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    await orch.forceTick();
    await new Promise((r) => setTimeout(r, 500));

    const stats = orch.getStats();
    // With max_retries=1, the first attempt (attempt=0) fails, then it checks
    // attempt+1 >= max_retries => 1 >= 1 => true, so it releases
    expect(stats.released).toBe(1);
    expect(stats.running).toBe(0);
    await orch.stop();
  });

  it("continuation retry fires after turn limit hit", async () => {
    const issues = [makeIssue("id-cont", "PROJ-CONT")];
    const tracker = createMockTracker(issues);
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 10,
        max_turns: 20,
        max_retries: 3,
        max_retry_backoff_ms: 100,
        max_concurrent_agents_by_state: {},
      },
    });

    let callCount = 0;
    mockRunAgentSession.mockImplementation(
      async (params: { onEvent: (msg: unknown) => void }) => {
        callCount++;
        params.onEvent({
          type: "system",
          subtype: "init",
          session_id: `sess-cont-${callCount}`,
        });
        params.onEvent({
          type: "result",
          subtype: "success",
          session_id: `sess-cont-${callCount}`,
          is_max_turns: callCount === 1,
          usage: { input_tokens: 500, output_tokens: 250, cost_usd: 0.005 },
        });
        return {
          success: true,
          sessionId: `sess-cont-${callCount}`,
          turnCount: 5,
          tokenUsage: {
            input: 500,
            output: 250,
            cacheRead: 0,
            costUSD: 0.005,
          },
          hitTurnLimit: callCount === 1,
        };
      },
    );

    const orch = new Orchestrator({
      config,
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    await orch.forceTick();
    // Wait for first run + continuation retry (1s delay for continuation)
    await new Promise((r) => setTimeout(r, 3000));

    // The agent should have been called at least twice: once for the initial
    // run and once for the continuation retry
    expect(callCount).toBeGreaterThanOrEqual(2);
    await orch.stop();
  });

  it("forceTick works when orchestrator is not started", async () => {
    const issues = [makeIssue("id-force", "PROJ-FORCE")];
    const tracker = createMockTracker(issues);

    const orch = new Orchestrator({
      config: makeConfig(),
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    // Never called start(), but forceTick should still work
    fs.mkdirSync(tmpDir, { recursive: true });
    await orch.forceTick();
    await new Promise((r) => setTimeout(r, 500));

    expect(tracker.fetchCandidateIssues).toHaveBeenCalled();
    await orch.stop();
  });

  it("multiple issues dispatched in priority order", async () => {
    const issues = [
      makeIssue("id-low", "PROJ-LOW", { priority: 3 }),
      makeIssue("id-high", "PROJ-HIGH", { priority: 1 }),
      makeIssue("id-med", "PROJ-MED", { priority: 2 }),
    ];
    const tracker = createMockTracker(issues);

    const dispatchOrder: string[] = [];
    mockRunAgentSession.mockImplementation(
      async (params: {
        issue: NormalizedIssue;
        onEvent: (msg: unknown) => void;
      }) => {
        dispatchOrder.push(params.issue.identifier);
        params.onEvent({
          type: "system",
          subtype: "init",
          session_id: "sess-" + params.issue.identifier,
        });
        params.onEvent({
          type: "result",
          subtype: "success",
          usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
        });
        return defaultAgentResult();
      },
    );

    const orch = new Orchestrator({
      config: makeConfig(),
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    await orch.forceTick();
    await new Promise((r) => setTimeout(r, 1000));

    // All three should be dispatched, with highest priority first
    expect(dispatchOrder[0]).toBe("PROJ-HIGH");
    expect(dispatchOrder[1]).toBe("PROJ-MED");
    expect(dispatchOrder[2]).toBe("PROJ-LOW");
    await orch.stop();
  });

  it("per-state concurrency limits enforced", async () => {
    const issues = [
      makeIssue("id-todo-1", "PROJ-TODO-1", { state: "Todo" }),
      makeIssue("id-todo-2", "PROJ-TODO-2", { state: "Todo" }),
      makeIssue("id-todo-3", "PROJ-TODO-3", { state: "Todo" }),
      makeIssue("id-ip-1", "PROJ-IP-1", { state: "In Progress" }),
    ];
    const tracker = createMockTracker(issues);
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 10,
        max_turns: 20,
        max_retries: 5,
        max_retry_backoff_ms: 300_000,
        max_concurrent_agents_by_state: { Todo: 1 },
      },
    });

    const dispatched: string[] = [];
    // Make agent runs slow so concurrency limits are visible
    mockRunAgentSession.mockImplementation(
      async (params: {
        issue: NormalizedIssue;
        onEvent: (msg: unknown) => void;
      }) => {
        dispatched.push(params.issue.identifier);
        params.onEvent({
          type: "system",
          subtype: "init",
          session_id: "sess-" + params.issue.identifier,
        });
        // Simulate some work
        await new Promise((r) => setTimeout(r, 500));
        params.onEvent({
          type: "result",
          subtype: "success",
          usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
        });
        return defaultAgentResult();
      },
    );

    const orch = new Orchestrator({
      config,
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    await orch.forceTick();
    // Give time for dispatch but check before workers complete
    await new Promise((r) => setTimeout(r, 100));

    // Only 1 Todo should be dispatched (per-state limit), plus 1 In Progress
    const stats = orch.getStats();
    expect(stats.running).toBeLessThanOrEqual(2);

    await new Promise((r) => setTimeout(r, 1000));
    await orch.stop();
  });

  it("config update changes behavior", async () => {
    const issues = [makeIssue("id-1", "PROJ-1")];
    const tracker = createMockTracker(issues);
    const config = makeConfig();

    const orch = new Orchestrator({
      config,
      promptTemplate: "Original prompt",
      tracker,
      logger,
    });

    // Update config with new prompt
    const newConfig = makeConfig({
      polling: { interval_ms: 120_000 },
    });
    orch.updateConfig(newConfig, "Updated prompt");

    // Force tick to verify it still works after config update
    await orch.forceTick();
    await new Promise((r) => setTimeout(r, 500));

    expect(tracker.fetchCandidateIssues).toHaveBeenCalled();
    await orch.stop();
  });

  it("getRunningWorkers returns current workers", async () => {
    const issues = [makeIssue("id-1", "PROJ-1")];
    const tracker = createMockTracker(issues);

    // Make the agent run slow so we can observe the running state
    mockRunAgentSession.mockImplementation(
      async (params: { onEvent: (msg: unknown) => void }) => {
        params.onEvent({
          type: "system",
          subtype: "init",
          session_id: "sess-obs",
        });
        await new Promise((r) => setTimeout(r, 1000));
        params.onEvent({
          type: "result",
          subtype: "success",
          usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
        });
        return defaultAgentResult();
      },
    );

    const orch = new Orchestrator({
      config: makeConfig(),
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    await orch.forceTick();
    await new Promise((r) => setTimeout(r, 200));

    const workers = orch.getRunningWorkers();
    expect(workers.length).toBe(1);
    expect(workers[0].issue.identifier).toBe("PROJ-1");

    await new Promise((r) => setTimeout(r, 1500));
    await orch.stop();
  });

  it("getRetryQueue returns pending retries", async () => {
    const issues = [makeIssue("id-retry", "PROJ-RETRY")];
    const tracker = createMockTracker(issues);
    const config = makeConfig({
      agent: {
        max_concurrent_agents: 10,
        max_turns: 20,
        max_retries: 3,
        max_retry_backoff_ms: 60_000,
        max_concurrent_agents_by_state: {},
      },
    });

    mockRunAgentSession.mockImplementation(
      async (params: { onEvent: (msg: unknown) => void }) => {
        params.onEvent({
          type: "system",
          subtype: "init",
          session_id: "sess-retry",
        });
        params.onEvent({
          type: "result",
          subtype: "error",
        });
        return {
          success: false,
          sessionId: "sess-retry",
          turnCount: 1,
          tokenUsage: { input: 100, output: 50, cacheRead: 0, costUSD: 0.001 },
          error: "Something went wrong",
          hitTurnLimit: false,
        };
      },
    );

    const orch = new Orchestrator({
      config,
      promptTemplate: "Work on {{ issue.identifier }}",
      tracker,
      logger,
    });

    await orch.forceTick();
    await new Promise((r) => setTimeout(r, 500));

    const retries = orch.getRetryQueue();
    expect(retries.length).toBe(1);
    expect(retries[0].identifier).toBe("PROJ-RETRY");
    expect(retries[0].attempt).toBe(1);
    expect(retries[0].error).toBe("Something went wrong");
    await orch.stop();
  });

  it("getSessionTracker returns session tracker instance", async () => {
    const tracker = createMockTracker([]);
    const orch = new Orchestrator({
      config: makeConfig(),
      promptTemplate: "Work",
      tracker,
      logger,
    });

    const st = orch.getSessionTracker();
    expect(st).toBeDefined();
    expect(st.getAggregateTokens()).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      costUSD: 0,
    });
    await orch.stop();
  });
});
