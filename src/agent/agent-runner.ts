import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import type {
  NormalizedIssue,
  AgentRunResult,
  TokenUsage,
} from "../types/index.js";
import type { ClaudeConfig } from "../config/schema.js";
import { isAssistantMessage } from "./sdk-message-utils.js";
import { toErrorMessage } from "../util/errors.js";
import { emptyTokenUsage } from "../types/index.js";
export interface ToolPolicy {
  allowed: string[];
  denied: string[];
  stateOverrides?: Record<
    string,
    {
      allowed?: string[];
      denied?: string[];
    }
  >;
}

export interface AgentRunParams {
  issue: NormalizedIssue;
  workspacePath: string;
  prompt: string;
  attempt: number;
  resumeSessionId?: string;
  config: ClaudeConfig;
  onEvent: (msg: SDKMessage) => void;
  abortSignal: AbortSignal;
  toolPolicy?: ToolPolicy;
  issueState: string;
}

/**
 * Run a Claude Code agent session for an issue.
 * Uses the Claude Agent SDK to spawn a headless claude process.
 */
export async function runAgentSession(
  params: AgentRunParams,
): Promise<AgentRunResult> {
  const {
    workspacePath,
    prompt,
    config,
    onEvent,
    abortSignal,
    resumeSessionId,
  } = params;

  let sessionId: string | null = null;
  let turnCount = 0;
  const tokenUsage: TokenUsage = emptyTokenUsage();
  let hitTurnLimit = false;

  try {
    const options: Record<string, unknown> = {
      cwd: workspacePath,
      allowedTools: config.allowed_tools,
      disallowedTools: config.disallowed_tools,
      maxTurns: config.max_turns_per_run,
    };

    if (config.max_budget_usd) {
      options.maxBudgetUsd = config.max_budget_usd;
    }

    if (resumeSessionId) {
      options.resume = resumeSessionId;
    }

    // Wire tool policy into the SDK's permission system.
    // The Claude Agent SDK (0.2.x) does not expose a typed `canUseTool` callback
    // or `PreToolUse` hook on the `query()` options. Instead, we dynamically
    // adjust `allowedTools` and `disallowedTools` based on the tool policy and
    // current issue state, which the SDK does support.
    //
    // NOTE: If a future SDK version exposes a `canUseTool` callback or
    // `hooks.PreToolUse`, prefer that mechanism for finer-grained per-invocation
    // control (e.g., inspecting tool input). The static list approach here covers
    // the state-based allow/deny use case fully.
    if (params.toolPolicy) {
      const effectiveAllowed: string[] = [];
      const effectiveDenied: string[] = [];

      // Merge global policy lists
      effectiveAllowed.push(...params.toolPolicy.allowed);
      effectiveDenied.push(...params.toolPolicy.denied);

      // Apply state-specific overrides
      const statePolicy = params.toolPolicy.stateOverrides?.[params.issueState];
      if (statePolicy) {
        // State-level denied tools override any global allows
        if (statePolicy.denied) {
          effectiveDenied.push(...statePolicy.denied);
        }
        // State-level allowed tools supplement global allows
        if (statePolicy.allowed) {
          effectiveAllowed.push(...statePolicy.allowed);
        }
      }

      // Merge with any existing config-level tool lists
      if (effectiveAllowed.length > 0) {
        const existing = (options.allowedTools as string[] | undefined) ?? [];
        options.allowedTools = [...existing, ...effectiveAllowed];
      }
      if (effectiveDenied.length > 0) {
        const existing =
          (options.disallowedTools as string[] | undefined) ?? [];
        options.disallowedTools = [...existing, ...effectiveDenied];
      }
    }

    const result = query(prompt, {
      abortController: abortSignalToController(abortSignal),
      ...options,
    });

    for await (const msg of result) {
      // Forward to orchestrator for tracking
      onEvent(msg);

      if (isSystemInit(msg)) {
        sessionId = extractSessionId(msg);
      }

      if (isAssistantMessage(msg)) {
        turnCount++;
      }

      if (isResultMessage(msg)) {
        // Extract final token usage
        const usage = extractUsage(msg);
        if (usage) {
          tokenUsage.input = usage.input;
          tokenUsage.output = usage.output;
          tokenUsage.costUSD = usage.costUSD;
        }

        const isSuccess = extractSuccess(msg);
        hitTurnLimit = extractHitTurnLimit(msg);

        return {
          success: isSuccess,
          sessionId,
          turnCount,
          tokenUsage,
          hitTurnLimit,
        };
      }
    }

    // Stream ended without result message
    return {
      success: false,
      sessionId,
      turnCount,
      tokenUsage,
      error: "Agent stream ended without result",
      hitTurnLimit: false,
    };
  } catch (err) {
    const errorMessage = toErrorMessage(err);

    // Check if it was an abort
    if (abortSignal.aborted) {
      return {
        success: false,
        sessionId,
        turnCount,
        tokenUsage,
        error: "Agent session aborted",
        hitTurnLimit: false,
      };
    }

    return {
      success: false,
      sessionId,
      turnCount,
      tokenUsage,
      error: errorMessage,
      hitTurnLimit: false,
    };
  }
}

// --- Helpers ---

function abortSignalToController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller;
}

function isSystemInit(msg: SDKMessage): boolean {
  return msg.type === "system" && "subtype" in msg && msg.subtype === "init";
}

function isResultMessage(msg: SDKMessage): boolean {
  return msg.type === "result";
}

function extractSessionId(msg: SDKMessage): string | null {
  if ("session_id" in msg && typeof msg.session_id === "string") {
    return msg.session_id;
  }
  return null;
}

function extractSuccess(msg: SDKMessage): boolean {
  if ("subtype" in msg && msg.subtype === "success") return true;
  if ("subtype" in msg && msg.subtype === "error") return false;
  return false;
}

function extractHitTurnLimit(msg: SDKMessage): boolean {
  if ("is_max_turns" in msg && typeof msg.is_max_turns === "boolean") {
    return msg.is_max_turns;
  }
  return false;
}

function extractUsage(
  msg: SDKMessage,
): { input: number; output: number; costUSD: number } | null {
  if ("usage" in msg && msg.usage && typeof msg.usage === "object") {
    const u = msg.usage as Record<string, unknown>;
    return {
      input: (u.input_tokens as number) ?? 0,
      output: (u.output_tokens as number) ?? 0,
      costUSD: (u.cost_usd as number) ?? 0,
    };
  }
  return null;
}
