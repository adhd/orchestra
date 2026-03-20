import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveEnvVars } from "../../src/config/config.js";
import { WorkflowConfigSchema } from "../../src/config/schema.js";

describe("resolveEnvVars", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TEST_API_KEY = "test-key-123";
    process.env.TEST_ENDPOINT = "https://test.example.com";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves $VAR references to env vars", () => {
    expect(resolveEnvVars("$TEST_API_KEY")).toBe("test-key-123");
  });

  it("leaves non-$ strings unchanged", () => {
    expect(resolveEnvVars("plain-string")).toBe("plain-string");
  });

  it("throws for missing env var", () => {
    expect(() => resolveEnvVars("$NONEXISTENT_VAR")).toThrow(
      "Environment variable NONEXISTENT_VAR",
    );
  });

  it("resolves nested objects", () => {
    const result = resolveEnvVars({
      key: "$TEST_API_KEY",
      nested: { endpoint: "$TEST_ENDPOINT" },
    });
    expect(result).toEqual({
      key: "test-key-123",
      nested: { endpoint: "https://test.example.com" },
    });
  });

  it("resolves arrays", () => {
    const result = resolveEnvVars(["$TEST_API_KEY", "literal"]);
    expect(result).toEqual(["test-key-123", "literal"]);
  });

  it("passes through numbers and booleans", () => {
    expect(resolveEnvVars(42)).toBe(42);
    expect(resolveEnvVars(true)).toBe(true);
    expect(resolveEnvVars(null)).toBe(null);
  });
});

describe("WorkflowConfigSchema", () => {
  it("parses minimal config with defaults", () => {
    const result = WorkflowConfigSchema.parse({
      tracker: { api_key: "test-key" },
    });

    expect(result.tracker.kind).toBe("linear");
    expect(result.tracker.active_states).toEqual(["Todo", "In Progress"]);
    expect(result.polling.interval_ms).toBe(30_000);
    expect(result.agent.max_concurrent_agents).toBe(10);
    expect(result.agent.max_retries).toBe(5);
    expect(result.claude.stall_timeout_ms).toBe(600_000);
  });

  it("accepts tracker config without api_key (github/memory kinds)", () => {
    const result = WorkflowConfigSchema.parse({
      tracker: { kind: "github", owner: "acme", repo: "app" },
    });
    expect(result.tracker.kind).toBe("github");
    expect(result.tracker.owner).toBe("acme");
    expect(result.tracker.api_key).toBeUndefined();
  });

  it("rejects polling interval below minimum", () => {
    expect(() =>
      WorkflowConfigSchema.parse({
        tracker: { api_key: "test" },
        polling: { interval_ms: 100 },
      }),
    ).toThrow();
  });

  it("accepts full config", () => {
    const result = WorkflowConfigSchema.parse({
      tracker: {
        kind: "linear",
        api_key: "key",
        project_slug: "my-project",
        active_states: ["Custom State"],
        terminal_states: ["Custom Done"],
      },
      polling: { interval_ms: 60_000 },
      workspace: { root: "/tmp/test" },
      hooks: {
        after_create: "echo setup",
        timeout_ms: 30_000,
      },
      agent: {
        max_concurrent_agents: 5,
        max_turns: 50,
        max_concurrent_agents_by_state: { Todo: 2 },
      },
      claude: {
        model: "claude-opus-4-6",
        max_turns_per_run: 10,
        max_budget_usd: 5.0,
      },
      server: { port: 9090 },
    });

    expect(result.tracker.project_slug).toBe("my-project");
    expect(result.agent.max_concurrent_agents).toBe(5);
    expect(result.claude.model).toBe("claude-opus-4-6");
    expect(result.server.port).toBe(9090);
  });
});
