import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so the mock fn is available in the factory
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-code", () => ({
  query: mockQuery,
}));

import { runAgentSession } from "../../src/agent/agent-runner.js";
import type { NormalizedIssue } from "../../src/types/index.js";
import type { ClaudeConfig } from "../../src/config/schema.js";

function makeIssue(): NormalizedIssue {
  return {
    id: "issue-1",
    identifier: "PROJ-1",
    title: "Test issue",
    description: null,
    priority: 1,
    state: "Todo",
    labels: [],
    blocked_by: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    branch_name: null,
    url: null,
  };
}

function makeConfig(): ClaudeConfig {
  return {
    model: "claude-sonnet-4-6",
    stall_timeout_ms: 600_000,
    state_overrides: {},
  };
}

/** Create an async iterable from an array of messages */
async function* asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe("runAgentSession", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("successful run returns correct AgentRunResult", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        { type: "system", subtype: "init", session_id: "sess-abc" },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "hi" }] },
        },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "done" }] },
        },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-abc",
          usage: { input_tokens: 1000, output_tokens: 500, cost_usd: 0.01 },
        },
      ]),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("sess-abc");
    expect(result.turnCount).toBe(2);
    expect(result.tokenUsage.input).toBe(1000);
    expect(result.tokenUsage.output).toBe(500);
    expect(result.tokenUsage.costUSD).toBe(0.01);
    expect(result.hitTurnLimit).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("aborted run returns error with 'Agent session aborted'", async () => {
    const ac = new AbortController();

    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "system", subtype: "init", session_id: "sess-abort" };
        // Simulate abort during streaming
        ac.abort("user_cancel");
        throw new Error("Aborted");
      })(),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: ac.signal,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Agent session aborted");
    expect(result.sessionId).toBe("sess-abort");
  });

  it("error during streaming returns error result", async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: "system", subtype: "init", session_id: "sess-err" };
        throw new Error("Connection lost");
      })(),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Connection lost");
    expect(result.sessionId).toBe("sess-err");
    expect(result.hitTurnLimit).toBe(false);
  });

  it("stream ending without result message returns error", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        { type: "system", subtype: "init", session_id: "sess-noend" },
        { type: "assistant", message: { content: [] } },
        // No result message
      ]),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Agent stream ended without result");
    expect(result.sessionId).toBe("sess-noend");
    expect(result.turnCount).toBe(1);
  });

  it("detects hit turn limit via is_max_turns", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        { type: "system", subtype: "init", session_id: "sess-max" },
        { type: "assistant", message: { content: [] } },
        {
          type: "result",
          subtype: "success",
          is_max_turns: true,
          usage: { input_tokens: 2000, output_tokens: 1000, cost_usd: 0.03 },
        },
      ]),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.success).toBe(true);
    expect(result.hitTurnLimit).toBe(true);
  });

  it("extracts session ID from system init message", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        { type: "system", subtype: "init", session_id: "unique-sess-id-42" },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
        },
      ]),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.sessionId).toBe("unique-sess-id-42");
  });

  it("returns null sessionId when no system init message", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        { type: "assistant", message: { content: [] } },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
        },
      ]),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.sessionId).toBeNull();
  });

  it("extracts token usage from result message", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 5000, output_tokens: 2500, cost_usd: 0.05 },
        },
      ]),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.tokenUsage).toEqual({
      input: 5000,
      output: 2500,
      cacheRead: 0,
      costUSD: 0.05,
    });
  });

  it("handles result message without usage field", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([{ type: "result", subtype: "success" }]),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.success).toBe(true);
    expect(result.tokenUsage).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      costUSD: 0,
    });
  });

  it("multiple assistant messages increment turn count", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        { type: "system", subtype: "init", session_id: "sess-turns" },
        { type: "assistant", message: { content: [] } },
        { type: "assistant", message: { content: [] } },
        { type: "assistant", message: { content: [] } },
        { type: "assistant", message: { content: [] } },
        { type: "assistant", message: { content: [] } },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
        },
      ]),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.turnCount).toBe(5);
  });

  it("forwards every message to onEvent callback", async () => {
    const messages = [
      { type: "system", subtype: "init", session_id: "sess-fwd" },
      { type: "assistant", message: { content: [] } },
      {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
      },
    ];
    mockQuery.mockReturnValue(asyncIterableFrom(messages));

    const onEvent = vi.fn();
    await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent,
      abortSignal: new AbortController().signal,
    });

    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEvent).toHaveBeenNthCalledWith(1, messages[0]);
    expect(onEvent).toHaveBeenNthCalledWith(2, messages[1]);
    expect(onEvent).toHaveBeenNthCalledWith(3, messages[2]);
  });

  it("error result subtype returns success=false", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        {
          type: "result",
          subtype: "error",
          usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
        },
      ]),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.success).toBe(false);
  });

  it("passes resumeSessionId as resume option", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
        },
      ]),
    );

    await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Continue",
      attempt: 1,
      resumeSessionId: "prev-session-123",
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      "Continue",
      expect.objectContaining({ resume: "prev-session-123" }),
    );
  });

  it("passes allowed_tools and disallowed_tools from config", async () => {
    mockQuery.mockReturnValue(
      asyncIterableFrom([
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 },
        },
      ]),
    );

    const config = makeConfig();
    config.allowed_tools = ["Read", "Write"];
    config.disallowed_tools = ["Bash"];

    await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config,
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      "Do work",
      expect.objectContaining({
        allowedTools: ["Read", "Write"],
        disallowedTools: ["Bash"],
      }),
    );
  });

  it("non-Error thrown produces string error message", async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        throw "string error value";
      })(),
    );

    const result = await runAgentSession({
      issue: makeIssue(),
      workspacePath: "/tmp/test",
      prompt: "Do work",
      attempt: 0,
      config: makeConfig(),
      onEvent: vi.fn(),
      abortSignal: new AbortController().signal,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("string error value");
  });
});
