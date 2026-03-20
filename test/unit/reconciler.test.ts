import { describe, it, expect, vi } from "vitest";
import { reconcile } from "../../src/orchestrator/reconciler.js";
import type {
  TrackerClient,
  WorkerEntry,
  NormalizedIssue,
} from "../../src/types/index.js";
import pino from "pino";

const logger = pino({ level: "silent" });

function makeIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: overrides.id ?? "issue-1",
    identifier: overrides.identifier ?? "PROJ-1",
    title: overrides.title ?? "Test issue",
    description: null,
    priority: null,
    state: overrides.state ?? "In Progress",
    labels: [],
    blocked_by: [],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    branch_name: null,
    url: null,
    ...overrides,
  };
}

function makeWorker(
  overrides: Partial<WorkerEntry> & { issue?: Partial<NormalizedIssue> } = {},
): WorkerEntry {
  const { issue: issueOverrides, ...rest } = overrides;
  return {
    issue: makeIssue(issueOverrides),
    sessionId: "session-1",
    turnCount: 0,
    attempt: 1,
    startedAt: Date.now(),
    lastEventAt: Date.now(),
    runAttemptState: "streaming_turn",
    abortController: new AbortController(),
    tokenUsage: { input: 0, output: 0, cacheRead: 0, costUSD: 0 },
    ...rest,
  };
}

function makeTracker(stateMap: Map<string, string> = new Map()): TrackerClient {
  return {
    fetchCandidateIssues: vi.fn().mockResolvedValue([]),
    fetchIssueStatesByIds: vi.fn().mockResolvedValue(stateMap),
  };
}

const TERMINAL_STATES = ["Done", "Canceled", "Cancelled"];

describe("reconcile", () => {
  it("aborts a worker with old lastEventAt (stall detection)", async () => {
    const worker = makeWorker({ lastEventAt: Date.now() - 120_000 });
    const running = new Map([["issue-1", worker]]);
    const tracker = makeTracker(new Map([["issue-1", "In Progress"]]));

    const result = await reconcile(
      running,
      tracker,
      TERMINAL_STATES,
      60_000,
      logger,
    );

    expect(result.stalled).toContain("issue-1");
    expect(worker.abortController.signal.aborted).toBe(true);
  });

  it("does not stall-detect when stallTimeoutMs <= 0", async () => {
    const worker = makeWorker({ lastEventAt: Date.now() - 999_999 });
    const running = new Map([["issue-1", worker]]);
    const tracker = makeTracker(new Map([["issue-1", "In Progress"]]));

    const result = await reconcile(
      running,
      tracker,
      TERMINAL_STATES,
      0,
      logger,
    );

    expect(result.stalled).toHaveLength(0);
    expect(worker.abortController.signal.aborted).toBe(false);
  });

  it("aborts worker when issue reaches a terminal state", async () => {
    const worker = makeWorker();
    const running = new Map([["issue-1", worker]]);
    const tracker = makeTracker(new Map([["issue-1", "Done"]]));

    const result = await reconcile(
      running,
      tracker,
      TERMINAL_STATES,
      60_000,
      logger,
    );

    expect(result.terminal).toContain("issue-1");
    expect(worker.abortController.signal.aborted).toBe(true);
  });

  it("updates cached issue state for non-terminal states", async () => {
    const worker = makeWorker({ issue: { state: "Todo" } });
    const running = new Map([["issue-1", worker]]);
    const tracker = makeTracker(new Map([["issue-1", "In Progress"]]));

    await reconcile(running, tracker, TERMINAL_STATES, 60_000, logger);

    expect(worker.issue.state).toBe("In Progress");
  });

  it("keeps worker running when issue is not found in tracker", async () => {
    const worker = makeWorker();
    const running = new Map([["issue-1", worker]]);
    // Empty map -- issue not found
    const tracker = makeTracker(new Map());

    const result = await reconcile(
      running,
      tracker,
      TERMINAL_STATES,
      60_000,
      logger,
    );

    expect(result.terminal).toHaveLength(0);
    expect(result.stalled).toHaveLength(0);
    expect(worker.abortController.signal.aborted).toBe(false);
  });

  it("preserves all workers when tracker fetch throws", async () => {
    const worker = makeWorker();
    const running = new Map([["issue-1", worker]]);
    const tracker: TrackerClient = {
      fetchCandidateIssues: vi.fn(),
      fetchIssueStatesByIds: vi
        .fn()
        .mockRejectedValue(new Error("network failure")),
    };

    const result = await reconcile(
      running,
      tracker,
      TERMINAL_STATES,
      60_000,
      logger,
    );

    expect(result.errors).toContain("network failure");
    expect(worker.abortController.signal.aborted).toBe(false);
  });

  it("handles combined stall + terminal in same reconciliation", async () => {
    const stalledWorker = makeWorker({
      lastEventAt: Date.now() - 120_000,
      issue: { id: "issue-1", identifier: "PROJ-1" },
    });
    const terminalWorker = makeWorker({
      issue: { id: "issue-2", identifier: "PROJ-2" },
    });
    const running = new Map<string, WorkerEntry>([
      ["issue-1", stalledWorker],
      ["issue-2", terminalWorker],
    ]);
    const tracker = makeTracker(
      new Map([
        ["issue-1", "In Progress"],
        ["issue-2", "Done"],
      ]),
    );

    const result = await reconcile(
      running,
      tracker,
      TERMINAL_STATES,
      60_000,
      logger,
    );

    expect(result.stalled).toContain("issue-1");
    expect(result.terminal).toContain("issue-2");
    expect(stalledWorker.abortController.signal.aborted).toBe(true);
    expect(terminalWorker.abortController.signal.aborted).toBe(true);
  });
});
