import type {
  NormalizedIssue,
  WorkerEntry,
  TrackerClient,
  IssueOrcState,
  AgentRunResult,
  StateEvent,
} from "../types/index.js";
import type { WorkflowConfig } from "../config/schema.js";
import { transition } from "./state-machine.js";
import { isEligible, sortCandidates } from "./dispatch.js";
import { RetryQueue } from "./retry-queue.js";
import { reconcile } from "./reconciler.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { runAgentSession } from "../agent/agent-runner.js";
import {
  buildFullPrompt,
  buildContinuationPrompt,
} from "../agent/prompt-builder.js";
import { SessionTracker } from "../agent/session-tracker.js";
import { CircuitBreaker } from "../agent/circuit-breaker.js";
import { AgentFileLogger } from "../observability/agent-logger.js";
import { AuditTrail } from "../observability/audit-trail.js";
import type { HistoryLog, HistoryEntry } from "../observability/history.js";
import type { ToolPolicy } from "../agent/agent-runner.js";
import { extractToolUses } from "../agent/sdk-message-utils.js";
import type { SDKMessage } from "@anthropic-ai/claude-code";
import type { Logger } from "pino";
import { EventBus } from "../events/event-bus.js";

export interface OrchestratorOptions {
  config: WorkflowConfig;
  promptTemplate: string;
  tracker: TrackerClient;
  logger: Logger;
  agentLogger?: AgentFileLogger;
  auditFilePath?: string;
  eventBus?: EventBus;
  historyLog?: HistoryLog;
}

export class Orchestrator {
  private config: WorkflowConfig;
  private promptTemplate: string;
  private tracker: TrackerClient;
  private logger: Logger;

  private runningMap = new Map<string, WorkerEntry>();
  private issueStates = new Map<string, IssueOrcState>();
  private releaseTimestamps = new Map<string, number>();
  private claimedSet = new Set<string>();
  private retryQueue: RetryQueue;
  private workspaceManager: WorkspaceManager;
  private sessionTracker = new SessionTracker();
  private agentLogger: AgentFileLogger | null;
  private auditTrail: AuditTrail | null;
  private historyLog: HistoryLog | null;
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private eventBus: EventBus | null;

  private workerPromises = new Map<string, Promise<void>>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private paused = false;
  private budgetAlertFired = false;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.promptTemplate = options.promptTemplate;
    this.tracker = options.tracker;
    this.logger = options.logger;

    this.agentLogger = options.agentLogger ?? null;
    this.auditTrail = options.auditFilePath
      ? new AuditTrail(options.auditFilePath)
      : null;
    this.eventBus = options.eventBus ?? null;
    this.historyLog = options.historyLog ?? null;
    this.retryQueue = new RetryQueue();
    this.workspaceManager = new WorkspaceManager(
      this.config.workspace.root,
      this.config.hooks,
    );
  }

  private transitionState(issueId: string, event: StateEvent): void {
    const current = this.issueStates.get(issueId) ?? "unclaimed";
    const next = transition(current, event);
    this.issueStates.set(issueId, next);
    if (next === "released") {
      this.releaseTimestamps.set(issueId, Date.now());
    }
  }

  private async scheduleNextTick(): Promise<void> {
    if (!this.running) return;
    await this.tick();
    if (this.running) {
      this.pollTimer = setTimeout(() => {
        this.scheduleNextTick().catch((err) => {
          this.logger.error({ error: String(err) }, "Tick failed");
        });
      }, this.config.polling.interval_ms);
    }
  }

  async start(): Promise<void> {
    this.running = true;
    this.workspaceManager.ensureRoot();

    // Start audit trail if configured
    if (this.auditTrail) {
      this.auditTrail.start();
    }

    // Start history log if configured
    if (this.historyLog) {
      this.historyLog.start();
    }

    this.logger.info(
      {
        workspace_root: this.config.workspace.root,
        interval_ms: this.config.polling.interval_ms,
      },
      "Orchestra starting",
    );

    // Start sequential tick loop (waits for each tick to complete)
    this.scheduleNextTick().catch((err) => {
      this.logger.error({ error: String(err) }, "Tick failed");
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.eventBus?.emit("shutdown:start", {});

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Cancel all retries
    this.retryQueue.cancelAll();

    // Abort all running workers
    for (const [, worker] of this.runningMap) {
      worker.abortController.abort("shutdown");
    }

    // Await all worker promises with a timeout
    const workerPromises = Array.from(this.workerPromises.values());
    if (workerPromises.length > 0) {
      const shutdownTimeout = 30_000;
      await Promise.race([
        Promise.allSettled(workerPromises),
        new Promise((resolve) => setTimeout(resolve, shutdownTimeout)),
      ]);
    }

    // Close agent log streams
    if (this.agentLogger) {
      this.agentLogger.closeAll();
    }

    // Stop audit trail
    if (this.auditTrail) {
      this.auditTrail.stop();
    }

    // Stop history log
    if (this.historyLog) {
      this.historyLog.stop();
    }

    this.eventBus?.emit("shutdown:complete", {});
    this.logger.info("Orchestra stopped");
  }

  updateConfig(config: WorkflowConfig, promptTemplate: string): void {
    this.config = config;
    this.promptTemplate = promptTemplate;

    // Reschedule poll timer if interval changed
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
      this.scheduleNextTick().catch((err) => {
        this.logger.error({ error: String(err) }, "Tick failed");
      });
    }

    this.eventBus?.emit("config:reloaded", { timestamp: Date.now() });
    this.logger.info("Config reloaded");
  }

  /**
   * Single poll tick: reconcile → fetch → sort → dispatch.
   */
  async tick(force = false): Promise<void> {
    if (!this.running && !force) return;
    const active = this.running || force;

    const tickTimestamp = Date.now();
    const tickLogger = this.logger.child({ tick: tickTimestamp });
    this.eventBus?.emit("tick:start", { timestamp: tickTimestamp });

    // Step 1: Reconcile
    const reconcileResult = await reconcile(
      this.runningMap,
      this.tracker,
      this.config.tracker.terminal_states,
      this.config.claude.stall_timeout_ms,
      tickLogger,
      async (identifier) => {
        try {
          await this.workspaceManager.remove(identifier);
        } catch (err) {
          tickLogger.warn(
            { identifier, error: String(err) },
            "Workspace cleanup failed",
          );
        }
      },
    );

    // Handle stalled/terminal workers (they'll complete via their abort handlers)
    for (const issueId of reconcileResult.stalled) {
      const worker = this.runningMap.get(issueId);
      this.eventBus?.emit("issue:stalled", {
        issueId,
        identifier: worker?.issue.identifier ?? issueId,
        elapsedMs: worker ? Date.now() - worker.lastEventAt : 0,
      });
      this.transitionState(issueId, { type: "reconcile_terminal" });
      this.claimedSet.delete(issueId);
    }
    for (const issueId of reconcileResult.terminal) {
      const worker = this.runningMap.get(issueId);
      this.eventBus?.emit("issue:terminal", {
        issueId,
        identifier: worker?.issue.identifier ?? issueId,
        state: worker?.issue.state ?? "unknown",
      });
      this.transitionState(issueId, { type: "reconcile_terminal" });
      this.claimedSet.delete(issueId);
    }

    // Budget check before dispatch
    if (this.config.agent.max_total_budget_usd !== undefined) {
      const totalSpent = this.sessionTracker.getAggregateTokens().costUSD;
      if (totalSpent >= this.config.agent.max_total_budget_usd) {
        this.eventBus?.emit("budget:exhausted", {
          spent: totalSpent,
          limit: this.config.agent.max_total_budget_usd,
        });
        tickLogger.warn(
          {
            spent: totalSpent,
            limit: this.config.agent.max_total_budget_usd,
          },
          "Budget limit reached, skipping dispatch",
        );
        return;
      }
      if (
        this.config.agent.budget_alert_usd !== undefined &&
        totalSpent >= this.config.agent.budget_alert_usd &&
        !this.budgetAlertFired
      ) {
        this.budgetAlertFired = true;
        this.eventBus?.emit("budget:alert", {
          spent: totalSpent,
          threshold: this.config.agent.budget_alert_usd,
        });
        tickLogger.warn(
          {
            spent: totalSpent,
            threshold: this.config.agent.budget_alert_usd,
          },
          "Budget alert threshold crossed",
        );
      }
    }

    // Pause check — existing workers continue, but no new dispatches
    if (this.paused) {
      tickLogger.info("Paused, skipping dispatch");
      return;
    }

    // Step 2: Fetch candidates
    let candidates: NormalizedIssue[];
    try {
      candidates = await this.tracker.fetchCandidateIssues(
        this.config.tracker.active_states,
      );
    } catch (err) {
      tickLogger.error(
        { error: String(err) },
        "Failed to fetch candidates, skipping dispatch",
      );
      return;
    }

    // Step 3: Sort by priority
    const sorted = sortCandidates(candidates);

    // Step 4: Dispatch eligible
    for (const issue of sorted) {
      if (!active) break;

      if (
        isEligible(
          issue,
          this.config.tracker.active_states,
          this.config.tracker.terminal_states,
          this.runningMap,
          this.retryQueue,
          this.claimedSet,
          this.config.agent,
        )
      ) {
        this.dispatchIssue(issue, 0, null);
      }
    }

    // Prune stale released entries to prevent memory leaks
    this.pruneReleasedIssues();

    this.eventBus?.emit("tick:complete", {
      timestamp: Date.now(),
      running: this.runningMap.size,
      retrying: this.retryQueue.size,
      candidates: candidates.length,
    });

    tickLogger.info(
      {
        running: this.runningMap.size,
        retrying: this.retryQueue.size,
        candidates: candidates.length,
      },
      "Tick complete",
    );
  }

  private dispatchIssue(
    issue: NormalizedIssue,
    attempt: number,
    resumeSessionId: string | null,
    alreadyClaimed = false,
  ): void {
    const issueLogger = this.logger.child({
      issue_id: issue.id,
      issue_identifier: issue.identifier,
      attempt,
    });

    if (!alreadyClaimed) {
      // Transition: unclaimed → claimed
      this.transitionState(issue.id, { type: "dispatch" });
    }
    this.claimedSet.add(issue.id);
    this.eventBus?.emit("issue:dispatched", {
      issueId: issue.id,
      identifier: issue.identifier,
      attempt,
    });

    // Start worker asynchronously and track the promise
    const workerPromise = this.runWorker(
      issue,
      attempt,
      resumeSessionId,
      issueLogger,
    ).catch((err) => {
      issueLogger.error({ error: String(err) }, "Worker failed unexpectedly");
      this.handleWorkerExit(issue, attempt, null, {
        success: false,
        sessionId: null,
        turnCount: 0,
        tokenUsage: { input: 0, output: 0, cacheRead: 0, costUSD: 0 },
        error: String(err),
        hitTurnLimit: false,
      });
    });
    this.workerPromises.set(issue.id, workerPromise);
    workerPromise.finally(() => this.workerPromises.delete(issue.id));
  }

  private async runWorker(
    issue: NormalizedIssue,
    attempt: number,
    resumeSessionId: string | null,
    logger: Logger,
  ): Promise<void> {
    const abortController = new AbortController();

    // Register in running map — transition: claimed → running
    const worker: WorkerEntry = {
      issue,
      sessionId: resumeSessionId,
      turnCount: 0,
      attempt,
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      runAttemptState: "preparing_workspace",
      abortController,
      tokenUsage: { input: 0, output: 0, cacheRead: 0, costUSD: 0 },
    };
    this.runningMap.set(issue.id, worker);
    this.transitionState(issue.id, { type: "worker_started" });
    this.claimedSet.delete(issue.id);

    try {
      // Prepare workspace
      const { path: wsPath } = await this.workspaceManager.getOrCreate(
        issue.identifier,
      );
      this.eventBus?.emit("worker:started", {
        issueId: issue.id,
        identifier: issue.identifier,
        workspacePath: wsPath,
      });
      worker.runAttemptState = "building_prompt";

      // Run before_run hook
      await this.workspaceManager.beforeRun(issue.identifier);

      // Build prompt
      let prompt: string;
      if (resumeSessionId) {
        prompt = buildContinuationPrompt(issue, attempt);
      } else {
        prompt = await buildFullPrompt(this.promptTemplate, {
          issue,
          attempt: attempt === 0 ? null : attempt,
          promptsDir: this.config.prompts_dir,
        });
      }
      worker.runAttemptState = "launching_agent";

      logger.info(
        { workspace: wsPath, has_resume: !!resumeSessionId },
        "Launching agent",
      );

      // Get effective config for this issue's state (merge state overrides)
      const stateOverride =
        this.config.claude.state_overrides?.[issue.state] ?? {};
      const effectiveConfig = { ...this.config.claude, ...stateOverride };

      // Run agent with circuit breaker for stuck-loop detection
      worker.runAttemptState = "streaming_turn";
      const circuitBreaker = new CircuitBreaker();
      this.circuitBreakers.set(issue.id, circuitBreaker);
      // Build tool policy from config, mapping snake_case config to camelCase ToolPolicy
      const toolPolicy = this.config.tool_policy
        ? {
            allowed: this.config.tool_policy.allowed,
            denied: this.config.tool_policy.denied,
            stateOverrides: this.config.tool_policy.state_overrides,
          }
        : undefined;

      const result = await runAgentSession({
        issue,
        workspacePath: wsPath,
        prompt,
        attempt,
        resumeSessionId: resumeSessionId ?? undefined,
        config: effectiveConfig,
        toolPolicy,
        issueState: issue.state,
        onEvent: (msg: SDKMessage) => {
          worker.lastEventAt = Date.now();
          const eventType =
            "type" in msg && typeof msg.type === "string"
              ? msg.type
              : "unknown";

          this.eventBus?.emit("worker:event", {
            issueId: issue.id,
            identifier: issue.identifier,
            eventType,
          });

          // Log to per-issue file if agent logger is configured
          if (this.agentLogger) {
            this.agentLogger.log(
              issue.identifier,
              eventType,
              JSON.stringify(msg),
            );
          }

          // Extract tool uses once for both audit trail and circuit breaker
          if (eventType === "assistant") {
            const toolUses = extractToolUses(msg);

            // Record tool use in audit trail
            if (this.auditTrail) {
              for (const tool of toolUses) {
                this.auditTrail.record({
                  timestamp: new Date().toISOString(),
                  issueId: issue.id,
                  identifier: issue.identifier,
                  sessionId: worker.sessionId,
                  eventType: "tool_use",
                  toolName: tool.name,
                });
              }
            }

            // Circuit breaker: detect agents stuck in tool loops
            if (toolUses.length > 0) {
              for (const tool of toolUses) {
                const tripped = circuitBreaker.recordToolUse(tool.name);
                if (tripped) {
                  logger.warn(
                    {
                      issue_id: issue.id,
                      identifier: issue.identifier,
                      tool: tool.name,
                    },
                    "Circuit breaker tripped: agent stuck in tool loop",
                  );
                  this.eventBus?.emit("issue:circuit_breaker", {
                    issueId: issue.id,
                    identifier: issue.identifier,
                    toolName: tool.name,
                  });
                  abortController.abort("circuit_breaker");
                  return;
                }
              }
            } else {
              // Assistant message with no tool use = text output = progress
              circuitBreaker.recordProgress();
            }
          }

          if ("session_id" in msg && typeof msg.session_id === "string") {
            if (!worker.sessionId) {
              worker.sessionId = msg.session_id;
              this.sessionTracker.start(
                msg.session_id,
                issue.id,
                issue.identifier,
              );
              this.eventBus?.emit("worker:agent_launched", {
                issueId: issue.id,
                identifier: issue.identifier,
                sessionId: msg.session_id,
              });
            }
            this.sessionTracker.updateEvent(msg.session_id, eventType);
          } else if (worker.sessionId) {
            this.sessionTracker.updateEvent(worker.sessionId, eventType);
          }
        },
        abortSignal: abortController.signal,
      });

      worker.runAttemptState = "finishing";

      // Run after_run hook
      await this.workspaceManager.afterRun(issue.identifier);

      worker.runAttemptState = result.success ? "succeeded" : "failed";
      logger.info(
        {
          success: result.success,
          turns: result.turnCount,
          tokens: result.tokenUsage,
          hit_turn_limit: result.hitTurnLimit,
          session_id: result.sessionId,
        },
        "Agent run completed",
      );

      // Cleanup circuit breaker
      this.circuitBreakers.delete(issue.id);

      // Complete session tracking
      if (result.sessionId) {
        this.sessionTracker.complete(result.sessionId);
      }

      this.handleWorkerExit(issue, attempt, resumeSessionId, result);
    } catch (err) {
      worker.runAttemptState = "failed";
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: errorMsg }, "Worker error");

      // Cleanup circuit breaker
      this.circuitBreakers.delete(issue.id);

      // Complete session tracking on error
      if (worker.sessionId) {
        this.sessionTracker.complete(worker.sessionId);
      }

      this.handleWorkerExit(issue, attempt, resumeSessionId, {
        success: false,
        sessionId: worker.sessionId,
        turnCount: worker.turnCount,
        tokenUsage: worker.tokenUsage,
        error: errorMsg,
        hitTurnLimit: false,
      });
    }
  }

  private handleWorkerExit(
    issue: NormalizedIssue,
    attempt: number,
    _resumeSessionId: string | null,
    result: AgentRunResult,
  ): void {
    // Record to history log before removing from running map
    if (this.historyLog) {
      const worker = this.runningMap.get(issue.id);
      const status: HistoryEntry["status"] = result.success
        ? "completed"
        : "failed";
      this.historyLog.record({
        timestamp: new Date().toISOString(),
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        status,
        attempts: attempt + 1,
        totalCostUSD: result.tokenUsage.costUSD,
        totalTurns: result.turnCount,
        sessionId: result.sessionId,
        error: result.error ?? null,
        durationMs: worker ? Date.now() - worker.startedAt : 0,
      });
    }

    // Remove from running map
    this.runningMap.delete(issue.id);

    if (result.success && result.hitTurnLimit) {
      // Continuation retry — agent hit turn limit but was successful
      if (attempt + 1 >= this.config.agent.max_retries) {
        this.eventBus?.emit("issue:max_retries", {
          issueId: issue.id,
          identifier: issue.identifier,
          attempt,
        });
        this.transitionState(issue.id, { type: "reconcile_terminal" });
        this.logger.warn(
          { issue_id: issue.id, identifier: issue.identifier, attempt },
          "Max retries reached on continuation, releasing issue",
        );
      } else {
        const delayMs = this.config.agent.max_retry_backoff_ms;
        this.retryQueue.schedule(
          issue.id,
          issue.identifier,
          attempt + 1,
          "continuation",
          delayMs,
          (entry) => this.handleRetryFired(entry, issue, result.sessionId),
        );
        this.eventBus?.emit("issue:retry_scheduled", {
          issueId: issue.id,
          identifier: issue.identifier,
          attempt: attempt + 1,
          reason: "continuation",
          delayMs,
        });
        this.transitionState(issue.id, { type: "schedule_retry" });
        this.logger.info(
          { issue_id: issue.id, identifier: issue.identifier },
          "Scheduled continuation retry",
        );
      }
    } else if (!result.success) {
      // Failure retry with exponential backoff
      this.eventBus?.emit("issue:failed", {
        issueId: issue.id,
        identifier: issue.identifier,
        error: result.error ?? "Unknown error",
        attempt,
      });
      if (attempt + 1 >= this.config.agent.max_retries) {
        this.eventBus?.emit("issue:max_retries", {
          issueId: issue.id,
          identifier: issue.identifier,
          attempt,
        });
        this.transitionState(issue.id, { type: "reconcile_terminal" });
        this.logger.warn(
          {
            issue_id: issue.id,
            identifier: issue.identifier,
            attempt,
            error: result.error,
          },
          "Max retries reached, releasing issue",
        );
      } else {
        const delayMs = this.config.agent.max_retry_backoff_ms;
        this.retryQueue.schedule(
          issue.id,
          issue.identifier,
          attempt + 1,
          "failure",
          delayMs,
          (entry) => this.handleRetryFired(entry, issue, null),
          result.error ?? null,
        );
        this.eventBus?.emit("issue:retry_scheduled", {
          issueId: issue.id,
          identifier: issue.identifier,
          attempt: attempt + 1,
          reason: "failure",
          delayMs,
        });
        this.transitionState(issue.id, { type: "schedule_retry" });
        this.logger.warn(
          {
            issue_id: issue.id,
            identifier: issue.identifier,
            error: result.error,
          },
          "Scheduled failure retry",
        );
      }
    } else {
      // Success, no continuation needed — release
      this.eventBus?.emit("issue:completed", {
        issueId: issue.id,
        identifier: issue.identifier,
        success: true,
        sessionId: result.sessionId,
      });
      this.transitionState(issue.id, { type: "reconcile_terminal" });
      this.logger.info(
        { issue_id: issue.id, identifier: issue.identifier },
        "Issue completed successfully",
      );
    }
  }

  private handleRetryFired(
    entry: { issueId: string; identifier: string; attempt: number },
    issue: NormalizedIssue,
    resumeSessionId: string | null,
  ): void {
    // Re-check if issue is still eligible
    const currentState = this.issueStates.get(entry.issueId);
    if (currentState === "released") {
      this.logger.info(
        { issue_id: entry.issueId, identifier: entry.identifier },
        "Retry fired but issue already released",
      );
      return;
    }

    this.transitionState(entry.issueId, { type: "retry_fired" });
    this.dispatchIssue(issue, entry.attempt, resumeSessionId, true);
  }

  /**
   * Prune released issue states older than 1 hour to prevent memory leaks.
   */
  private pruneReleasedIssues(): void {
    const cutoff = Date.now() - 3_600_000; // 1 hour
    for (const [issueId, timestamp] of this.releaseTimestamps) {
      if (timestamp < cutoff) {
        this.issueStates.delete(issueId);
        this.releaseTimestamps.delete(issueId);
      }
    }
  }

  // --- Operational controls ---

  pause(): void {
    this.paused = true;
    this.eventBus?.emit("orchestrator:paused", {});
    this.logger.info("Orchestrator paused — no new dispatches");
  }

  resume(): void {
    this.paused = false;
    this.eventBus?.emit("orchestrator:resumed", {});
    this.logger.info("Orchestrator resumed");
  }

  isPaused(): boolean {
    return this.paused;
  }

  cancelWorker(identifier: string): boolean {
    for (const [issueId, worker] of this.runningMap) {
      if (worker.issue.identifier === identifier) {
        worker.abortController.abort("user_canceled");
        this.eventBus?.emit("issue:canceled", { issueId, identifier });
        this.logger.info({ identifier }, "Worker canceled by user");
        return true;
      }
    }
    return false;
  }

  // --- Observability getters ---

  getRunningWorkers(): WorkerEntry[] {
    return Array.from(this.runningMap.values());
  }

  getRetryQueue(): Array<{
    issueId: string;
    identifier: string;
    attempt: number;
    dueAtMs: number;
    error: string | null;
  }> {
    return this.retryQueue.getAll().map((e) => ({
      issueId: e.issueId,
      identifier: e.identifier,
      attempt: e.attempt,
      dueAtMs: e.dueAtMs,
      error: e.error,
    }));
  }

  getEventBus(): EventBus | null {
    return this.eventBus;
  }

  getSessionTracker(): SessionTracker {
    return this.sessionTracker;
  }

  getStats(): {
    running: number;
    retrying: number;
    released: number;
    paused: boolean;
    totalSpentUSD: number;
    budgetLimitUSD: number | null;
  } {
    let released = 0;
    for (const state of this.issueStates.values()) {
      if (state === "released") released++;
    }
    return {
      running: this.runningMap.size,
      retrying: this.retryQueue.size,
      released,
      paused: this.paused,
      totalSpentUSD: this.sessionTracker.getAggregateTokens().costUSD,
      budgetLimitUSD: this.config.agent.max_total_budget_usd ?? null,
    };
  }

  getHistory(limit: number = 50): HistoryEntry[] {
    if (!this.historyLog) return [];
    return this.historyLog.getRecent(limit);
  }

  getHistoryLog(): HistoryLog | null {
    return this.historyLog;
  }

  /**
   * Force an immediate tick (for the /api/v1/refresh endpoint).
   */
  async forceTick(): Promise<void> {
    await this.tick(true);
  }
}
