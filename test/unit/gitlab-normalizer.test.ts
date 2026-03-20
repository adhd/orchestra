import { describe, it, expect } from "vitest";
import {
  extractPriority,
  normalizeGitLabIssue,
  type GitLabRawIssue,
} from "../../src/tracker/gitlab-normalizer.js";

function makeRawIssue(overrides: Partial<GitLabRawIssue> = {}): GitLabRawIssue {
  return {
    id: 100,
    iid: 7,
    title: "Fix the pipeline",
    description: "The CI pipeline is failing on main.",
    labels: ["bug", "todo"],
    state: "opened",
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-12T00:00:00Z",
    web_url: "https://gitlab.com/acme/project/-/issues/7",
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

  it("recognizes GitLab scoped labels (priority::N)", () => {
    expect(extractPriority(["priority::0"])).toBe(0);
    expect(extractPriority(["priority::1"])).toBe(1);
    expect(extractPriority(["priority::2"])).toBe(2);
    expect(extractPriority(["priority::3"])).toBe(3);
  });

  it("recognizes priority:N and priority-N patterns", () => {
    expect(extractPriority(["priority:1"])).toBe(1);
    expect(extractPriority(["priority-2"])).toBe(2);
    expect(extractPriority(["priority 0"])).toBe(0);
  });

  it("returns the first matching priority when multiple exist", () => {
    expect(extractPriority(["low", "p0"])).toBe(3); // "low" matches first
  });

  it("returns null for empty labels array", () => {
    expect(extractPriority([])).toBeNull();
  });
});

describe("normalizeGitLabIssue", () => {
  it("maps all fields correctly", () => {
    const raw = makeRawIssue();
    const result = normalizeGitLabIssue(raw, "acme/project", "todo");

    expect(result).toEqual({
      id: "7",
      identifier: "acme/project#7",
      title: "Fix the pipeline",
      description: "The CI pipeline is failing on main.",
      priority: null, // "bug" and "todo" are not priority labels
      state: "todo",
      labels: ["bug", "todo"],
      blocked_by: [],
      created_at: "2026-03-10T00:00:00Z",
      updated_at: "2026-03-12T00:00:00Z",
      branch_name: null,
      url: "https://gitlab.com/acme/project/-/issues/7",
    });
  });

  it("handles null description", () => {
    const raw = makeRawIssue({ description: null });
    const result = normalizeGitLabIssue(raw, "acme/project", "todo");
    expect(result.description).toBeNull();
  });

  it("handles empty labels", () => {
    const raw = makeRawIssue({ labels: [] });
    const result = normalizeGitLabIssue(raw, "acme/project", "todo");
    expect(result.labels).toEqual([]);
    expect(result.priority).toBeNull();
  });

  it("extracts priority from labels", () => {
    const raw = makeRawIssue({ labels: ["priority::1", "todo"] });
    const result = normalizeGitLabIssue(raw, "acme/project", "todo");
    expect(result.priority).toBe(1);
  });

  it("uses the provided currentLabel as state", () => {
    const raw = makeRawIssue();
    const result = normalizeGitLabIssue(raw, "acme/project", "in-progress");
    expect(result.state).toBe("in-progress");
  });

  it("uses iid (not id) as the normalized id", () => {
    const raw = makeRawIssue({ id: 9999, iid: 42 });
    const result = normalizeGitLabIssue(raw, "acme/project", "todo");
    expect(result.id).toBe("42");
    expect(result.identifier).toBe("acme/project#42");
  });
});
