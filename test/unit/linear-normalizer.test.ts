import { describe, it, expect } from "vitest";
import {
  normalizeLinearIssue,
  type LinearRawIssue,
} from "../../src/tracker/linear-normalizer.js";

const rawIssue: LinearRawIssue = {
  id: "abc-123",
  identifier: "PROJ-42",
  title: "Fix the bug",
  description: "Something is broken",
  priority: 2,
  state: { name: "Todo" },
  labels: { nodes: [{ name: "bug" }, { name: "urgent" }] },
  relations: {
    nodes: [
      {
        type: "blocks",
        relatedIssue: {
          identifier: "PROJ-40",
          state: { name: "In Progress" },
        },
      },
      {
        type: "related",
        relatedIssue: {
          identifier: "PROJ-41",
          state: { name: "Done" },
        },
      },
    ],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  branchName: "proj-42-fix-bug",
  url: "https://linear.app/proj/issue/PROJ-42",
};

describe("normalizeLinearIssue", () => {
  it("maps all fields correctly", () => {
    const result = normalizeLinearIssue(rawIssue);

    expect(result.id).toBe("abc-123");
    expect(result.identifier).toBe("PROJ-42");
    expect(result.title).toBe("Fix the bug");
    expect(result.description).toBe("Something is broken");
    expect(result.priority).toBe(2);
    expect(result.state).toBe("Todo");
    expect(result.labels).toEqual(["bug", "urgent"]);
    expect(result.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(result.updated_at).toBe("2026-01-02T00:00:00.000Z");
    expect(result.branch_name).toBe("proj-42-fix-bug");
    expect(result.url).toBe("https://linear.app/proj/issue/PROJ-42");
  });

  it("extracts only 'blocks' relations for blocked_by", () => {
    const result = normalizeLinearIssue(rawIssue);
    // Only the "blocks" type should be included, and we store the identifier
    expect(result.blocked_by).toEqual(["PROJ-40"]);
  });

  it("handles missing optional fields", () => {
    const minimal: LinearRawIssue = {
      id: "min-1",
      identifier: "MIN-1",
      title: "Minimal",
      priority: 0,
      state: { name: "Todo" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      url: "https://linear.app/min/1",
    };

    const result = normalizeLinearIssue(minimal);

    expect(result.description).toBeNull();
    expect(result.labels).toEqual([]);
    expect(result.blocked_by).toEqual([]);
    expect(result.branch_name).toBeNull();
  });
});
