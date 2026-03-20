import { describe, it, expect } from "vitest";
import { renderDashboard } from "../../src/observability/dashboard.js";
import type { WorkerEntry, TokenUsage } from "../../src/types/index.js";
import { emptyTokenUsage } from "../../src/types/index.js";

function makeTokenUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return { ...emptyTokenUsage(), ...overrides };
}

function makeWorkerEntry(overrides: Partial<WorkerEntry> = {}): WorkerEntry {
  return {
    issue: {
      id: "issue-1",
      identifier: "PROJ-1",
      title: "Test issue",
      description: null,
      priority: null,
      state: "In Progress",
      labels: [],
      blocked_by: [],
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      branch_name: null,
      url: null,
    },
    sessionId: "session-1",
    turnCount: 3,
    attempt: 1,
    startedAt: Date.now() - 60_000,
    lastEventAt: Date.now(),
    runAttemptState: "streaming_turn",
    abortController: new AbortController(),
    tokenUsage: makeTokenUsage({ input: 1000, output: 500, costUSD: 0.0123 }),
    ...overrides,
  };
}

describe("renderDashboard", () => {
  it("renders HTML with correct stats", () => {
    const html = renderDashboard({
      stats: {
        running: 3,
        retrying: 1,
        released: 7,
        paused: false,
        totalSpentUSD: 1.23,
        budgetLimitUSD: null,
      },
      workers: [makeWorkerEntry()],
      retries: [],
      tokens: makeTokenUsage({ input: 50000, output: 25000, costUSD: 1.23 }),
      history: [],
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Orchestra");
    // Stats
    expect(html).toContain(">3<");
    expect(html).toContain(">1<");
    expect(html).toContain(">7<");
    expect(html).toContain("$1.23");
    // Worker row
    expect(html).toContain("PROJ-1");
    expect(html).toContain("$0.0123");
  });

  it("escapes HTML in issue titles (XSS prevention)", () => {
    const worker = makeWorkerEntry();
    worker.issue.title = '<script>alert("xss")</script>';

    const html = renderDashboard({
      stats: {
        running: 1,
        retrying: 0,
        released: 0,
        paused: false,
        totalSpentUSD: 0,
        budgetLimitUSD: null,
      },
      workers: [worker],
      retries: [],
      tokens: makeTokenUsage(),
      history: [],
    });

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
  });

  it("handles empty workers and retries", () => {
    const html = renderDashboard({
      stats: {
        running: 0,
        retrying: 0,
        released: 0,
        paused: false,
        totalSpentUSD: 0,
        budgetLimitUSD: null,
      },
      workers: [],
      retries: [],
      tokens: makeTokenUsage(),
      history: [],
    });

    expect(html).toContain("No running workers");
    expect(html).toContain("No pending retries");
  });

  it("formats durations correctly", () => {
    // Worker started 90 minutes ago
    const worker = makeWorkerEntry({
      startedAt: Date.now() - 90 * 60 * 1000,
    });

    const html = renderDashboard({
      stats: {
        running: 1,
        retrying: 0,
        released: 0,
        paused: false,
        totalSpentUSD: 0,
        budgetLimitUSD: null,
      },
      workers: [worker],
      retries: [],
      tokens: makeTokenUsage(),
      history: [],
    });

    // 90 minutes = 1h 30m
    expect(html).toContain("1h 30m");
  });

  it("formats token counts with K and M suffixes", () => {
    const html = renderDashboard({
      stats: {
        running: 0,
        retrying: 0,
        released: 0,
        paused: false,
        totalSpentUSD: 0,
        budgetLimitUSD: null,
      },
      workers: [],
      retries: [],
      tokens: makeTokenUsage({ input: 1_500_000, output: 500_000 }),
      history: [],
    });

    // 2_000_000 total = 2.0M
    expect(html).toContain("2.0M");
  });

  it("formats token counts with K suffix for thousands", () => {
    const html = renderDashboard({
      stats: {
        running: 0,
        retrying: 0,
        released: 0,
        paused: false,
        totalSpentUSD: 0,
        budgetLimitUSD: null,
      },
      workers: [],
      retries: [],
      tokens: makeTokenUsage({ input: 45_000, output: 5_000 }),
      history: [],
    });

    // 50_000 total = 50.0K
    expect(html).toContain("50.0K");
  });
});
