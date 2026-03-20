// Issue orchestration states (SPEC 6.1)
export type IssueOrcState =
  | "unclaimed"
  | "claimed"
  | "running"
  | "retry_queued"
  | "released";

// Run attempt lifecycle (SPEC 6.2)
export type RunAttemptState =
  | "preparing_workspace"
  | "building_prompt"
  | "launching_agent"
  | "streaming_turn"
  | "finishing"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "stalled"
  | "canceled_by_reconciliation";

// Normalized issue (SPEC 4.1.1)
export interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  labels: string[];
  blocked_by: string[];
  created_at: string;
  updated_at: string;
  branch_name: string | null;
  url: string | null;
}

// Worker entry in the running map
export interface WorkerEntry {
  issue: NormalizedIssue;
  sessionId: string | null;
  turnCount: number;
  attempt: number;
  startedAt: number;
  lastEventAt: number;
  runAttemptState: RunAttemptState;
  abortController: AbortController;
  tokenUsage: TokenUsage;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  costUSD: number;
}

export function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, costUSD: 0 };
}

// Retry entry
export interface RetryEntry {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  reason: "continuation" | "failure";
  error: string | null;
  timerHandle: ReturnType<typeof setTimeout>;
}

// Agent run result
export interface AgentRunResult {
  success: boolean;
  sessionId: string | null;
  turnCount: number;
  tokenUsage: TokenUsage;
  error?: string;
  hitTurnLimit: boolean;
}

// State machine events
export type StateEvent =
  | { type: "dispatch" }
  | { type: "worker_started" }
  | { type: "schedule_retry" }
  | { type: "retry_fired" }
  | { type: "reconcile_terminal" };

// Tracker client interface
export interface TrackerClient {
  fetchCandidateIssues(activeStates: string[]): Promise<NormalizedIssue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Map<string, string>>;
}
