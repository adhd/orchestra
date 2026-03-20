import { describe, it, expect, beforeEach } from "vitest";
import { MemoryTracker } from "../../src/tracker/memory-tracker.js";
import type { NormalizedIssue } from "../../src/types/index.js";

function makeIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: "issue-1",
    identifier: "DEMO-1",
    title: "Test issue",
    description: "A test issue",
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

describe("MemoryTracker", () => {
  let tracker: MemoryTracker;

  beforeEach(() => {
    tracker = new MemoryTracker();
  });

  it("returns empty arrays when no issues exist", async () => {
    const candidates = await tracker.fetchCandidateIssues(["Todo"]);
    expect(candidates).toEqual([]);

    const states = await tracker.fetchIssueStatesByIds(["nonexistent"]);
    expect(states.size).toBe(0);

    expect(tracker.getAllIssues()).toEqual([]);
  });

  it("adds an issue and retrieves it via fetchCandidateIssues", async () => {
    tracker.addIssue(makeIssue({ id: "a", state: "Todo" }));

    const candidates = await tracker.fetchCandidateIssues(["Todo"]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("a");
  });

  it("filters by active states", async () => {
    tracker.addIssue(makeIssue({ id: "a", state: "Todo" }));
    tracker.addIssue(makeIssue({ id: "b", state: "In Progress" }));
    tracker.addIssue(makeIssue({ id: "c", state: "Done" }));

    const todos = await tracker.fetchCandidateIssues(["Todo"]);
    expect(todos).toHaveLength(1);
    expect(todos[0].id).toBe("a");

    const active = await tracker.fetchCandidateIssues(["Todo", "In Progress"]);
    expect(active).toHaveLength(2);
  });

  it("stores a defensive copy of added issues", () => {
    const issue = makeIssue({ id: "a" });
    tracker.addIssue(issue);

    // Mutating the original should not affect the tracker
    issue.title = "mutated";
    expect(tracker.getAllIssues()[0].title).toBe("Test issue");
  });

  it("overwrites an issue when added with the same id", () => {
    tracker.addIssue(makeIssue({ id: "a", title: "First" }));
    tracker.addIssue(makeIssue({ id: "a", title: "Second" }));

    const all = tracker.getAllIssues();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Second");
  });

  it("sets the state of an existing issue", async () => {
    tracker.addIssue(makeIssue({ id: "a", state: "Todo" }));

    tracker.setState("a", "In Progress");

    const states = await tracker.fetchIssueStatesByIds(["a"]);
    expect(states.get("a")).toBe("In Progress");

    const candidates = await tracker.fetchCandidateIssues(["In Progress"]);
    expect(candidates).toHaveLength(1);
  });

  it("setState is a no-op for unknown ids", () => {
    // Should not throw
    tracker.setState("nonexistent", "Done");
    expect(tracker.getAllIssues()).toEqual([]);
  });

  it("fetchIssueStatesByIds returns correct map for multiple ids", async () => {
    tracker.addIssue(makeIssue({ id: "a", state: "Todo" }));
    tracker.addIssue(makeIssue({ id: "b", state: "In Progress" }));
    tracker.addIssue(makeIssue({ id: "c", state: "Done" }));

    const states = await tracker.fetchIssueStatesByIds(["a", "b", "missing"]);
    expect(states.size).toBe(2);
    expect(states.get("a")).toBe("Todo");
    expect(states.get("b")).toBe("In Progress");
    expect(states.has("missing")).toBe(false);
  });

  it("getAllIssues returns all issues regardless of state", () => {
    tracker.addIssue(makeIssue({ id: "a", state: "Todo" }));
    tracker.addIssue(makeIssue({ id: "b", state: "Done" }));

    expect(tracker.getAllIssues()).toHaveLength(2);
  });
});
