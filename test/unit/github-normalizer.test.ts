import { describe, it, expect } from "vitest";
import {
  extractPriority,
  normalizeGitHubIssue,
  type GitHubRawIssue,
} from "../../src/tracker/github-normalizer.js";

function makeRawIssue(overrides: Partial<GitHubRawIssue> = {}): GitHubRawIssue {
  return {
    id: "I_abc123",
    number: 42,
    title: "Fix the widget",
    body: "It is broken.",
    labels: [{ name: "bug" }, { name: "todo" }],
    createdAt: "2026-03-10T00:00:00Z",
    updatedAt: "2026-03-12T00:00:00Z",
    url: "https://github.com/acme/repo/issues/42",
    assignees: [{ login: "alice" }],
    ...overrides,
  };
}

describe("extractPriority", () => {
  it("returns null when no priority labels present", () => {
    expect(extractPriority(["bug", "enhancement"])).toBeNull();
  });

  it("recognizes p0-p3 labels", () => {
    expect(extractPriority(["p0"])).toBe(0);
    expect(extractPriority(["P1"])).toBe(1);
    expect(extractPriority(["p2"])).toBe(2);
    expect(extractPriority(["p3"])).toBe(3);
  });

  it("recognizes named priority labels", () => {
    expect(extractPriority(["Critical"])).toBe(0);
    expect(extractPriority(["HIGH"])).toBe(1);
    expect(extractPriority(["Medium"])).toBe(2);
    expect(extractPriority(["low"])).toBe(3);
  });

  it("recognizes priority:N pattern", () => {
    expect(extractPriority(["priority:1"])).toBe(1);
    expect(extractPriority(["priority-2"])).toBe(2);
    expect(extractPriority(["priority 0"])).toBe(0);
  });

  it("returns the first matching priority when multiple exist", () => {
    expect(extractPriority(["low", "p0"])).toBe(3); // "low" matches first
  });
});

describe("normalizeGitHubIssue", () => {
  it("maps all fields correctly", () => {
    const raw = makeRawIssue();
    const result = normalizeGitHubIssue(raw, "acme", "repo", "todo");

    expect(result).toEqual({
      id: "42",
      identifier: "acme/repo#42",
      title: "Fix the widget",
      description: "It is broken.",
      priority: null, // "bug" and "todo" are not priority labels
      state: "todo",
      labels: ["bug", "todo"],
      blocked_by: [],
      created_at: "2026-03-10T00:00:00Z",
      updated_at: "2026-03-12T00:00:00Z",
      branch_name: null,
      url: "https://github.com/acme/repo/issues/42",
    });
  });

  it("handles null body", () => {
    const raw = makeRawIssue({ body: null });
    const result = normalizeGitHubIssue(raw, "acme", "repo", "todo");
    expect(result.description).toBeNull();
  });

  it("extracts priority from labels", () => {
    const raw = makeRawIssue({
      labels: [{ name: "p1" }, { name: "todo" }],
    });
    const result = normalizeGitHubIssue(raw, "acme", "repo", "todo");
    expect(result.priority).toBe(1);
  });

  it("uses the provided currentLabel as state", () => {
    const raw = makeRawIssue();
    const result = normalizeGitHubIssue(raw, "acme", "repo", "in-progress");
    expect(result.state).toBe("in-progress");
  });
});
