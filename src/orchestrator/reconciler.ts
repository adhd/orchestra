import type { TrackerClient, WorkerEntry } from "../types/index.js";
import type { Logger } from "pino";

export interface ReconcileResult {
  stalled: string[];
  terminal: string[];
  errors: string[];
}

/**
 * Reconcile running workers against tracker state.
 * Part A: Stall detection — kill workers with no recent events.
 * Part B: State refresh — terminate workers for terminal-state issues.
 */
export async function reconcile(
  runningMap: Map<string, WorkerEntry>,
  tracker: TrackerClient,
  terminalStates: string[],
  stallTimeoutMs: number,
  logger: Logger,
  onTerminal?: (identifier: string) => Promise<void>,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { stalled: [], terminal: [], errors: [] };
  const now = Date.now();

  // Part A: Stall detection
  if (stallTimeoutMs > 0) {
    for (const [issueId, worker] of runningMap) {
      const elapsed = now - worker.lastEventAt;
      if (elapsed > stallTimeoutMs) {
        logger.warn(
          {
            issue_id: issueId,
            identifier: worker.issue.identifier,
            elapsed_ms: elapsed,
          },
          "Stall detected, aborting worker",
        );
        worker.abortController.abort("stall_timeout");
        result.stalled.push(issueId);
      }
    }
  }

  // Part B: State refresh
  if (runningMap.size === 0) return result;

  try {
    const issueIds = Array.from(runningMap.keys());
    const currentStates = await tracker.fetchIssueStatesByIds(issueIds);

    for (const [issueId, worker] of runningMap) {
      const currentState = currentStates.get(issueId);
      if (!currentState) {
        // Issue not found — might be deleted, keep running
        logger.warn(
          { issue_id: issueId, identifier: worker.issue.identifier },
          "Issue not found during reconciliation, keeping worker",
        );
        continue;
      }

      if (terminalStates.includes(currentState)) {
        logger.info(
          {
            issue_id: issueId,
            identifier: worker.issue.identifier,
            state: currentState,
          },
          "Issue reached terminal state, stopping worker",
        );
        worker.abortController.abort("terminal_state");
        result.terminal.push(issueId);
        if (onTerminal) {
          await onTerminal(worker.issue.identifier).catch((err) => {
            logger.warn(
              { identifier: worker.issue.identifier, error: String(err) },
              "onTerminal callback failed",
            );
          });
        }
      } else {
        // Update cached state
        worker.issue.state = currentState;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { error: msg },
      "Reconciliation state refresh failed, keeping workers",
    );
    result.errors.push(msg);
  }

  return result;
}
