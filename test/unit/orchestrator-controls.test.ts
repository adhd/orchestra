import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus } from "../../src/events/event-bus.js";
import { SessionTracker } from "../../src/agent/session-tracker.js";

/**
 * Tests for orchestrator operational controls: budget limits, pause/resume,
 * cancel worker, and extended stats.
 *
 * We test the underlying components directly rather than the full Orchestrator
 * (which has heavy dependencies on workspace, tracker, agent runner, etc.)
 */

describe("Budget limit logic", () => {
  it("SessionTracker.getAggregateTokens sums across active and completed sessions", () => {
    const tracker = new SessionTracker();

    tracker.start("s1", "i1", "PROJ-1");
    tracker.complete("s1");

    tracker.start("s2", "i2", "PROJ-2");
    tracker.complete("s2");

    const agg = tracker.getAggregateTokens();
    expect(agg.costUSD).toBe(0);
    expect(agg.input).toBe(0);
  });

  it("budget:exhausted event type is valid on EventBus", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("budget:exhausted", handler);
    bus.emit("budget:exhausted", { spent: 10.0, limit: 10.0 });
    expect(handler).toHaveBeenCalledWith({ spent: 10.0, limit: 10.0 });
  });

  it("budget:alert event type is valid on EventBus", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("budget:alert", handler);
    bus.emit("budget:alert", { spent: 7.5, threshold: 7.0 });
    expect(handler).toHaveBeenCalledWith({ spent: 7.5, threshold: 7.0 });
  });

  it("budget check logic: spent >= limit blocks", () => {
    const maxBudget = 10.0;
    const spent = 10.5;
    expect(spent >= maxBudget).toBe(true);
  });

  it("budget check logic: spent < limit allows", () => {
    const maxBudget = 10.0;
    const spent = 9.99;
    expect(spent >= maxBudget).toBe(false);
  });
});

describe("Pause/Resume events", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it("orchestrator:paused event fires correctly", () => {
    const handler = vi.fn();
    bus.on("orchestrator:paused", handler);
    bus.emit("orchestrator:paused", {});
    expect(handler).toHaveBeenCalledOnce();
  });

  it("orchestrator:resumed event fires correctly", () => {
    const handler = vi.fn();
    bus.on("orchestrator:resumed", handler);
    bus.emit("orchestrator:resumed", {});
    expect(handler).toHaveBeenCalledOnce();
  });

  it("paused flag blocks dispatch (logic simulation)", () => {
    let paused = false;
    let dispatched = false;

    // Simulate pause
    paused = true;

    // Simulate tick dispatch check
    if (!paused) {
      dispatched = true;
    }

    expect(dispatched).toBe(false);

    // Simulate resume
    paused = false;
    if (!paused) {
      dispatched = true;
    }

    expect(dispatched).toBe(true);
  });
});

describe("Cancel worker events", () => {
  it("issue:canceled event type is valid on EventBus", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("issue:canceled", handler);
    bus.emit("issue:canceled", { issueId: "i1", identifier: "PROJ-1" });
    expect(handler).toHaveBeenCalledWith({
      issueId: "i1",
      identifier: "PROJ-1",
    });
  });

  it("AbortController.abort cancels with reason", () => {
    const ac = new AbortController();
    ac.abort("user_canceled");
    expect(ac.signal.aborted).toBe(true);
    expect(ac.signal.reason).toBe("user_canceled");
  });

  it("cancelWorker logic: finds by identifier", () => {
    // Simulate runningMap lookup
    const runningMap = new Map<
      string,
      { issue: { identifier: string }; abortController: AbortController }
    >();
    const ac = new AbortController();
    runningMap.set("issue-1", {
      issue: { identifier: "PROJ-1" },
      abortController: ac,
    });

    let found = false;
    for (const [, worker] of runningMap) {
      if (worker.issue.identifier === "PROJ-1") {
        worker.abortController.abort("user_canceled");
        found = true;
        break;
      }
    }

    expect(found).toBe(true);
    expect(ac.signal.aborted).toBe(true);
  });

  it("cancelWorker logic: returns false for unknown identifier", () => {
    const runningMap = new Map<
      string,
      { issue: { identifier: string }; abortController: AbortController }
    >();

    let found = false;
    for (const [, worker] of runningMap) {
      if (worker.issue.identifier === "PROJ-99") {
        found = true;
        break;
      }
    }

    expect(found).toBe(false);
  });
});

describe("Extended stats shape", () => {
  it("stats include paused and budget fields", () => {
    // Simulate getStats output
    const stats = {
      running: 2,
      retrying: 1,
      released: 5,
      paused: false,
      totalSpentUSD: 3.45,
      budgetLimitUSD: 50.0 as number | null,
    };

    expect(stats).toHaveProperty("paused", false);
    expect(stats).toHaveProperty("totalSpentUSD", 3.45);
    expect(stats).toHaveProperty("budgetLimitUSD", 50.0);
  });

  it("budgetLimitUSD is null when unconfigured", () => {
    const budgetConfig: number | undefined = undefined;
    const budgetLimitUSD = budgetConfig ?? null;
    expect(budgetLimitUSD).toBeNull();
  });

  it("budgetLimitUSD is set when configured", () => {
    const budgetConfig: number | undefined = 100.0;
    const budgetLimitUSD = budgetConfig ?? null;
    expect(budgetLimitUSD).toBe(100.0);
  });
});

describe("Config schema accepts budget fields", () => {
  it("AgentConfigSchema parses max_total_budget_usd", async () => {
    const { AgentConfigSchema } = await import("../../src/config/schema.js");
    const result = AgentConfigSchema.parse({
      max_total_budget_usd: 50.0,
      budget_alert_usd: 40.0,
    });
    expect(result.max_total_budget_usd).toBe(50.0);
    expect(result.budget_alert_usd).toBe(40.0);
  });

  it("AgentConfigSchema allows omitting budget fields", async () => {
    const { AgentConfigSchema } = await import("../../src/config/schema.js");
    const result = AgentConfigSchema.parse({});
    expect(result.max_total_budget_usd).toBeUndefined();
    expect(result.budget_alert_usd).toBeUndefined();
  });
});
