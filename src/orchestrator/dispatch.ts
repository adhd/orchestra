import type {
  NormalizedIssue,
  WorkerEntry,
  RetryEntry,
} from "../types/index.js";
import type { AgentConfig } from "../config/schema.js";

/**
 * Check if an issue is eligible for dispatch.
 * Implements SPEC eligibility rules:
 * - Must have required fields
 * - Must be in active states
 * - Not already running or claimed
 * - Not in retry queue
 * - Concurrency slots available (global + per-state)
 * - Todo issues with non-terminal blockers are rejected
 */
export function isEligible(
  issue: NormalizedIssue,
  activeStates: string[],
  terminalStates: string[],
  runningMap: {
    size: number;
    has(key: string): boolean;
    values(): Iterable<WorkerEntry>;
  },
  retryMap: { has(key: string): boolean },
  claimedSet: { has(key: string): boolean },
  config: AgentConfig,
): boolean {
  // Required fields
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
    return false;
  }

  // Must be in active state
  if (!activeStates.includes(issue.state)) {
    return false;
  }

  // Not already running, claimed, or in retry
  if (
    runningMap.has(issue.id) ||
    retryMap.has(issue.id) ||
    claimedSet.has(issue.id)
  ) {
    return false;
  }

  // Issues with blockers are rejected (blocked_by stores identifiers)
  if (issue.blocked_by.length > 0) {
    return false;
  }

  // Global concurrency check
  if (runningMap.size >= config.max_concurrent_agents) {
    return false;
  }

  // Per-state concurrency check
  const stateLimit = config.max_concurrent_agents_by_state[issue.state];
  if (stateLimit !== undefined) {
    const stateCount = Array.from(runningMap.values()).filter(
      (w) => w.issue.state === issue.state,
    ).length;
    if (stateCount >= stateLimit) {
      return false;
    }
  }

  return true;
}

/**
 * Sort candidates by priority (ascending), then oldest creation time, then identifier.
 * Matches SPEC dispatch ordering.
 */
export function sortCandidates(issues: NormalizedIssue[]): NormalizedIssue[] {
  return [...issues].sort((a, b) => {
    // Priority ascending (lower = higher priority). Null priority sorts last.
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;

    // Oldest creation time first
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;

    // Lexicographic identifier tiebreak
    return a.identifier.localeCompare(b.identifier);
  });
}
