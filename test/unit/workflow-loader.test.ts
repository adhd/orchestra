import { describe, it, expect } from "vitest";
import { parseWorkflow } from "../../src/config/workflow-loader.js";

describe("workflow-loader", () => {
  it("parses valid WORKFLOW.md with front matter and prompt", () => {
    const content = `---
tracker:
  api_key: test-key
  project_slug: test-project
agent:
  max_concurrent_agents: 3
---

You are working on **{{ issue.identifier }}**: {{ issue.title }}
`;

    const result = parseWorkflow(content);

    expect(result.config.tracker.api_key).toBe("test-key");
    expect(result.config.tracker.project_slug).toBe("test-project");
    expect(result.config.agent.max_concurrent_agents).toBe(3);
    expect(result.promptTemplate).toContain("{{ issue.identifier }}");
    expect(result.promptTemplate).toContain("{{ issue.title }}");
  });

  it("applies defaults for missing config sections", () => {
    const content = `---
tracker:
  api_key: key
---

Simple prompt.
`;

    const result = parseWorkflow(content);

    expect(result.config.polling.interval_ms).toBe(30_000);
    expect(result.config.agent.max_concurrent_agents).toBe(10);
    expect(result.config.claude.stall_timeout_ms).toBe(600_000);
    expect(result.promptTemplate).toBe("Simple prompt.");
  });

  it("throws on invalid YAML config", () => {
    const content = `---
tracker:
  api_key: 123
  project_slug: test
polling:
  interval_ms: 100
---

Prompt.
`;

    expect(() => parseWorkflow(content)).toThrow();
  });

  it("throws on missing required fields", () => {
    const content = `---
agent:
  max_concurrent_agents: 5
---

Prompt.
`;

    expect(() => parseWorkflow(content)).toThrow();
  });

  it("handles empty prompt body", () => {
    const content = `---
tracker:
  api_key: key
---
`;

    const result = parseWorkflow(content);
    expect(result.promptTemplate).toBe("");
  });
});
