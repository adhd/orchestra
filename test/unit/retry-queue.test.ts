import { describe, it, expect, vi, afterEach } from "vitest";
import {
  RetryQueue,
  calculateRetryDelay,
} from "../../src/orchestrator/retry-queue.js";

describe("calculateRetryDelay", () => {
  it("returns 1000ms for continuation retries", () => {
    expect(calculateRetryDelay(1, "continuation", 300_000)).toBe(1_000);
    expect(calculateRetryDelay(5, "continuation", 300_000)).toBe(1_000);
  });

  it("returns exponential backoff for failure retries", () => {
    expect(calculateRetryDelay(1, "failure", 300_000)).toBe(10_000);
    expect(calculateRetryDelay(2, "failure", 300_000)).toBe(20_000);
    expect(calculateRetryDelay(3, "failure", 300_000)).toBe(40_000);
    expect(calculateRetryDelay(4, "failure", 300_000)).toBe(80_000);
  });

  it("caps at max backoff", () => {
    expect(calculateRetryDelay(100, "failure", 300_000)).toBe(300_000);
  });

  it("handles attempt 0 gracefully", () => {
    expect(calculateRetryDelay(0, "failure", 300_000)).toBe(10_000);
  });
});

describe("RetryQueue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts empty", () => {
    const q = new RetryQueue();
    expect(q.size).toBe(0);
    expect(q.has("x")).toBe(false);
  });

  it("schedules and fires a retry", async () => {
    vi.useFakeTimers();
    const q = new RetryQueue();
    const fired = vi.fn();

    q.schedule("issue-1", "PROJ-1", 1, "continuation", 300_000, fired);

    expect(q.size).toBe(1);
    expect(q.has("issue-1")).toBe(true);

    vi.advanceTimersByTime(1_000);

    expect(fired).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(0);

    vi.useRealTimers();
  });

  it("cancels a retry", () => {
    vi.useFakeTimers();
    const q = new RetryQueue();
    const fired = vi.fn();

    q.schedule("issue-1", "PROJ-1", 1, "failure", 300_000, fired);
    expect(q.cancel("issue-1")).toBe(true);
    expect(q.size).toBe(0);

    vi.advanceTimersByTime(100_000);
    expect(fired).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("replaces existing retry for same issue", () => {
    vi.useFakeTimers();
    const q = new RetryQueue();
    const fired1 = vi.fn();
    const fired2 = vi.fn();

    q.schedule("issue-1", "PROJ-1", 1, "failure", 300_000, fired1);
    q.schedule("issue-1", "PROJ-1", 2, "failure", 300_000, fired2);

    expect(q.size).toBe(1);
    expect(q.get("issue-1")?.attempt).toBe(2);

    vi.advanceTimersByTime(300_000);
    expect(fired1).not.toHaveBeenCalled();
    expect(fired2).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("cancelAll clears everything", () => {
    vi.useFakeTimers();
    const q = new RetryQueue();
    const fired = vi.fn();

    q.schedule("a", "A", 1, "failure", 300_000, fired);
    q.schedule("b", "B", 1, "failure", 300_000, fired);
    q.schedule("c", "C", 1, "failure", 300_000, fired);

    q.cancelAll();
    expect(q.size).toBe(0);

    vi.advanceTimersByTime(300_000);
    expect(fired).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
