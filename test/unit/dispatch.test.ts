import { describe, it, expect } from "vitest";
import { isEligible, sortCandidates } from "../../src/orchestrator/dispatch.js";
import type {
  NormalizedIssue,
  WorkerEntry,
  RetryEntry,
} from "../../src/types/index.js";
import type { AgentConfig } from "../../src/config/schema.js";

function makeIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: "issue-1",
    identifier: "PROJ-1",
    title: "Test issue",
    description: null,
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

const defaultConfig: AgentConfig = {
  max_concurrent_agents: 10,
  max_turns: 20,
  max_retries: 5,
  max_retry_backoff_ms: 300_000,
  max_concurrent_agents_by_state: {},
};

const activeStates = ["Todo", "In Progress"];

describe("dispatch", () => {
  describe("isEligible", () => {
    it("accepts a valid issue", () => {
      expect(
        isEligible(
          makeIssue(),
          activeStates,
          new Map(),
          new Map(),
          new Set(),
          defaultConfig,
        ),
      ).toBe(true);
    });

    it("rejects issue missing required fields", () => {
      expect(
        isEligible(
          makeIssue({ id: "" }),
          activeStates,
          new Map(),
          new Map(),
          new Set(),
          defaultConfig,
        ),
      ).toBe(false);
    });

    it("rejects issue not in active state", () => {
      expect(
        isEligible(
          makeIssue({ state: "Done" }),
          activeStates,
          new Map(),
          new Map(),
          new Set(),
          defaultConfig,
        ),
      ).toBe(false);
    });

    it("rejects already running issue", () => {
      const running = new Map([["issue-1", {} as WorkerEntry]]);
      expect(
        isEligible(
          makeIssue(),
          activeStates,
          running,
          new Map(),
          new Set(),
          defaultConfig,
        ),
      ).toBe(false);
    });

    it("rejects already claimed issue", () => {
      expect(
        isEligible(
          makeIssue(),
          activeStates,
          new Map(),
          new Map(),
          new Set(["issue-1"]),
          defaultConfig,
        ),
      ).toBe(false);
    });

    it("rejects issue in retry queue", () => {
      const retrying = new Map([["issue-1", {} as RetryEntry]]);
      expect(
        isEligible(
          makeIssue(),
          activeStates,
          new Map(),
          retrying,
          new Set(),
          defaultConfig,
        ),
      ).toBe(false);
    });

    it("rejects when global concurrency is full", () => {
      const running = new Map(
        Array.from({ length: 10 }, (_, i) => [`other-${i}`, {} as WorkerEntry]),
      );
      expect(
        isEligible(
          makeIssue(),
          activeStates,
          running,
          new Map(),
          new Set(),
          defaultConfig,
        ),
      ).toBe(false);
    });

    it("rejects when per-state concurrency is full", () => {
      const config = {
        ...defaultConfig,
        max_concurrent_agents_by_state: { Todo: 1 },
      };
      const running = new Map([
        ["other-1", { issue: { state: "Todo" } } as WorkerEntry],
      ]);
      expect(
        isEligible(
          makeIssue(),
          activeStates,
          running,
          new Map(),
          new Set(),
          config,
        ),
      ).toBe(false);
    });

    it("rejects issue with blockers", () => {
      expect(
        isEligible(
          makeIssue({ blocked_by: ["PROJ-40"] }),
          activeStates,
          new Map(),
          new Map(),
          new Set(),
          defaultConfig,
        ),
      ).toBe(false);
    });

    it("accepts issue with empty blocked_by", () => {
      expect(
        isEligible(
          makeIssue({ blocked_by: [] }),
          activeStates,
          new Map(),
          new Map(),
          new Set(),
          defaultConfig,
        ),
      ).toBe(true);
    });
  });

  describe("sortCandidates", () => {
    it("sorts by priority ascending", () => {
      const issues = [
        makeIssue({ id: "a", priority: 3 }),
        makeIssue({ id: "b", priority: 1 }),
        makeIssue({ id: "c", priority: 2 }),
      ];
      const sorted = sortCandidates(issues);
      expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
    });

    it("breaks ties by oldest creation time", () => {
      const issues = [
        makeIssue({ id: "a", priority: 1, created_at: "2026-01-03T00:00:00Z" }),
        makeIssue({ id: "b", priority: 1, created_at: "2026-01-01T00:00:00Z" }),
        makeIssue({ id: "c", priority: 1, created_at: "2026-01-02T00:00:00Z" }),
      ];
      const sorted = sortCandidates(issues);
      expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
    });

    it("null priority sorts last", () => {
      const issues = [
        makeIssue({ id: "a", priority: null }),
        makeIssue({ id: "b", priority: 1 }),
      ];
      const sorted = sortCandidates(issues);
      expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
    });

    it("breaks all ties by identifier", () => {
      const issues = [
        makeIssue({ id: "a", identifier: "PROJ-3", priority: 1 }),
        makeIssue({ id: "b", identifier: "PROJ-1", priority: 1 }),
        makeIssue({ id: "c", identifier: "PROJ-2", priority: 1 }),
      ];
      const sorted = sortCandidates(issues);
      expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
    });
  });
});
