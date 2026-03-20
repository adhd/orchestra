import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubClient } from "../../src/tracker/github-client.js";

// Mock node:child_process so we never shell out during tests.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

/**
 * Helper: make the mocked execFile resolve with the given stdout for the
 * next N calls (one per invocation).
 */
function mockGhCalls(responses: Array<{ stdout: string } | Error>) {
  const mock = vi.mocked(execFile);
  let callIndex = 0;

  mock.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, _cb?: unknown) => {
      // promisify(execFile) calls execFile with a callback as the last arg.
      const cb =
        typeof _opts === "function"
          ? (_opts as (err: Error | null, result?: { stdout: string }) => void)
          : typeof _cb === "function"
            ? (_cb as (err: Error | null, result?: { stdout: string }) => void)
            : undefined;

      const resp = responses[callIndex++];
      if (!cb) {
        // Should not happen with promisify, but guard anyway.
        return undefined as never;
      }
      if (resp instanceof Error) {
        cb(resp);
      } else {
        cb(null, resp);
      }
      return undefined as never;
    },
  );
}

const SAMPLE_ISSUES = [
  {
    id: "I_1",
    number: 10,
    title: "First issue",
    body: "Body one",
    labels: [{ name: "todo" }, { name: "p1" }],
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-02T00:00:00Z",
    url: "https://github.com/acme/app/issues/10",
    assignees: [],
  },
  {
    id: "I_2",
    number: 11,
    title: "Second issue",
    body: null,
    labels: [{ name: "todo" }],
    createdAt: "2026-03-03T00:00:00Z",
    updatedAt: "2026-03-04T00:00:00Z",
    url: "https://github.com/acme/app/issues/11",
    assignees: [{ login: "bob" }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GitHubClient", () => {
  describe("fetchCandidateIssues", () => {
    it("fetches issues for each active label and deduplicates", async () => {
      const client = new GitHubClient({
        owner: "acme",
        repo: "app",
        active_labels: ["todo", "in-progress"],
      });

      // First label returns both issues, second label returns the first again.
      mockGhCalls([
        { stdout: JSON.stringify(SAMPLE_ISSUES) },
        { stdout: JSON.stringify([SAMPLE_ISSUES[0]]) },
      ]);

      const issues = await client.fetchCandidateIssues([]);

      expect(issues).toHaveLength(2);
      expect(issues[0].id).toBe("10");
      expect(issues[0].identifier).toBe("acme/app#10");
      expect(issues[0].priority).toBe(1);
      expect(issues[1].id).toBe("11");
    });

    it("uses provided activeStates instead of defaults", async () => {
      const client = new GitHubClient({
        owner: "acme",
        repo: "app",
      });

      mockGhCalls([{ stdout: JSON.stringify([SAMPLE_ISSUES[0]]) }]);

      const issues = await client.fetchCandidateIssues(["custom-label"]);

      expect(issues).toHaveLength(1);
      // Verify gh was called with the custom label
      const call = vi.mocked(execFile).mock.calls[0];
      const args = call[1] as string[];
      expect(args).toContain("custom-label");
    });

    it("skips labels that fail gracefully", async () => {
      const client = new GitHubClient({
        owner: "acme",
        repo: "app",
        active_labels: ["todo", "bad-label"],
      });

      mockGhCalls([
        { stdout: JSON.stringify([SAMPLE_ISSUES[0]]) },
        new Error("gh: label not found"),
      ]);

      const issues = await client.fetchCandidateIssues([]);

      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("10");
    });
  });

  describe("fetchIssueStatesByIds", () => {
    it("returns Done for closed issues", async () => {
      const client = new GitHubClient({
        owner: "acme",
        repo: "app",
      });

      mockGhCalls([
        {
          stdout: JSON.stringify({
            state: "CLOSED",
            labels: [{ name: "todo" }],
          }),
        },
      ]);

      const states = await client.fetchIssueStatesByIds(["10"]);
      expect(states.get("10")).toBe("Done");
    });

    it("determines state from active labels on open issues", async () => {
      const client = new GitHubClient({
        owner: "acme",
        repo: "app",
        active_labels: ["todo", "in-progress"],
      });

      mockGhCalls([
        {
          stdout: JSON.stringify({
            state: "OPEN",
            labels: [{ name: "in-progress" }, { name: "bug" }],
          }),
        },
      ]);

      const states = await client.fetchIssueStatesByIds(["10"]);
      expect(states.get("10")).toBe("in-progress");
    });

    it("determines state from terminal labels", async () => {
      const client = new GitHubClient({
        owner: "acme",
        repo: "app",
        terminal_labels: ["done", "wontfix"],
      });

      mockGhCalls([
        {
          stdout: JSON.stringify({
            state: "OPEN",
            labels: [{ name: "wontfix" }],
          }),
        },
      ]);

      const states = await client.fetchIssueStatesByIds(["10"]);
      expect(states.get("10")).toBe("wontfix");
    });

    it("returns unknown when no matching labels", async () => {
      const client = new GitHubClient({
        owner: "acme",
        repo: "app",
      });

      mockGhCalls([
        {
          stdout: JSON.stringify({
            state: "OPEN",
            labels: [{ name: "random-label" }],
          }),
        },
      ]);

      const states = await client.fetchIssueStatesByIds(["10"]);
      expect(states.get("10")).toBe("unknown");
    });

    it("skips issues that error", async () => {
      const client = new GitHubClient({
        owner: "acme",
        repo: "app",
      });

      mockGhCalls([new Error("not found")]);

      const states = await client.fetchIssueStatesByIds(["999"]);
      expect(states.size).toBe(0);
    });
  });
});
