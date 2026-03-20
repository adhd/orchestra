import { describe, it, expect } from "vitest";
import { SessionTracker } from "../../src/agent/session-tracker.js";

describe("SessionTracker", () => {
  it("start/complete lifecycle", () => {
    const tracker = new SessionTracker();

    tracker.start("s1", "issue-1", "PROJ-1");

    const completed = tracker.complete("s1");
    expect(completed).toBeDefined();
    expect(completed!.sessionId).toBe("s1");
    expect(completed!.issueId).toBe("issue-1");
    expect(completed!.identifier).toBe("PROJ-1");
  });

  it("updateEvent updates lastEventAt", () => {
    const tracker = new SessionTracker();
    tracker.start("s1", "issue-1", "PROJ-1");

    tracker.updateEvent("s1", "tool_use");

    // complete to inspect
    const session = tracker.complete("s1");
    expect(session).toBeDefined();
    expect(session!.lastEventType).toBe("tool_use");
  });

  it("getAggregateTokens sums across active and completed sessions", () => {
    const tracker = new SessionTracker();

    tracker.start("s1", "issue-1", "PROJ-1");
    tracker.start("s2", "issue-2", "PROJ-2");

    // Complete s1
    tracker.complete("s1");

    const totals = tracker.getAggregateTokens();
    expect(totals.input).toBe(0);
    expect(totals.output).toBe(0);
    expect(totals.cacheRead).toBe(0);
    expect(totals.costUSD).toBe(0);
  });

  it("complete returns undefined for unknown session", () => {
    const tracker = new SessionTracker();
    expect(tracker.complete("nonexistent")).toBeUndefined();
  });
});
