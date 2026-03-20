import type { RetryEntry } from "../types/index.js";

const CONTINUATION_DELAY_MS = 1_000;
const BASE_FAILURE_DELAY_MS = 10_000;

/**
 * Calculate retry delay based on attempt number and reason.
 * - Continuation retries: fixed 1s delay
 * - Failure retries: exponential backoff 10s * 2^(attempt-1), capped
 */
export function calculateRetryDelay(
  attempt: number,
  reason: "continuation" | "failure",
  maxBackoffMs: number,
): number {
  if (reason === "continuation") {
    return CONTINUATION_DELAY_MS;
  }
  const delay = BASE_FAILURE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(delay, maxBackoffMs);
}

/**
 * Manages the retry queue with timer-based scheduling.
 */
export class RetryQueue {
  private entries = new Map<string, RetryEntry>();

  get size(): number {
    return this.entries.size;
  }

  has(issueId: string): boolean {
    return this.entries.has(issueId);
  }

  get(issueId: string): RetryEntry | undefined {
    return this.entries.get(issueId);
  }

  getAll(): RetryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Schedule a retry for an issue.
   * Cancels any existing retry for the same issue.
   */
  schedule(
    issueId: string,
    identifier: string,
    attempt: number,
    reason: "continuation" | "failure",
    maxBackoffMs: number,
    onFired: (entry: RetryEntry) => void,
    error: string | null = null,
  ): RetryEntry {
    // Cancel existing
    this.cancel(issueId);

    const delayMs = calculateRetryDelay(attempt, reason, maxBackoffMs);
    const dueAtMs = Date.now() + delayMs;

    const entry: RetryEntry = {
      issueId,
      identifier,
      attempt,
      dueAtMs,
      reason,
      error,
      timerHandle: setTimeout(() => {
        this.entries.delete(issueId);
        onFired(entry);
      }, delayMs),
    };

    this.entries.set(issueId, entry);
    return entry;
  }

  /**
   * Cancel a pending retry.
   */
  cancel(issueId: string): boolean {
    const entry = this.entries.get(issueId);
    if (entry) {
      clearTimeout(entry.timerHandle);
      this.entries.delete(issueId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all pending retries. Used during shutdown.
   */
  cancelAll(): void {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timerHandle);
    }
    this.entries.clear();
  }
}
