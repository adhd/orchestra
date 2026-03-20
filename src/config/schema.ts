import { z } from "zod";
import os from "node:os";
import path from "node:path";

export const TrackerConfigSchema = z.object({
  kind: z.enum(["linear", "github", "gitlab", "memory"]).default("linear"),
  // Linear-specific
  endpoint: z.string().default("https://api.linear.app/graphql"),
  api_key: z.string().optional(), // required for linear; supports $VAR indirection
  project_slug: z.string().optional(),
  // GitHub-specific
  owner: z.string().optional(), // required for github
  repo: z.string().optional(), // required for github
  // GitLab-specific
  project_path: z.string().optional(), // required for gitlab; e.g. "group/project"
  token: z.string().optional(), // required for gitlab; personal access token
  gitlab_endpoint: z.string().optional(), // default: https://gitlab.com
  // Common
  active_states: z.array(z.string()).default(["Todo", "In Progress"]),
  terminal_states: z
    .array(z.string())
    .default(["Done", "Canceled", "Cancelled", "Closed", "Duplicate"]),
});

export const PollingConfigSchema = z
  .object({
    interval_ms: z.number().min(5000).default(30_000),
  })
  .default({});

export const WorkspaceConfigSchema = z
  .object({
    root: z.string().default(path.join(os.tmpdir(), "orchestra_workspaces")),
  })
  .default({});

export const HooksConfigSchema = z
  .object({
    after_create: z.string().optional(),
    before_run: z.string().optional(),
    after_run: z.string().optional(),
    before_remove: z.string().optional(),
    timeout_ms: z.number().default(60_000),
  })
  .default({});

export const AgentConfigSchema = z
  .object({
    max_concurrent_agents: z.number().min(1).default(10),
    max_turns: z.number().min(1).default(20),
    max_retry_backoff_ms: z.number().default(300_000),
    max_retries: z.number().min(0).default(5),
    max_concurrent_agents_by_state: z
      .record(z.string(), z.number())
      .default({}),
    max_total_budget_usd: z.number().optional(),
    budget_alert_usd: z.number().optional(),
  })
  .default({});

export const ClaudeConfigSchema = z
  .object({
    model: z.string().default("claude-sonnet-4-6"),
    max_turns_per_run: z.number().optional(),
    max_budget_usd: z.number().optional(),
    stall_timeout_ms: z.number().default(600_000),
    allowed_tools: z.array(z.string()).optional(),
    disallowed_tools: z.array(z.string()).optional(),
    state_overrides: z
      .record(
        z.string(),
        z
          .object({
            model: z.string().optional(),
            max_turns_per_run: z.number().optional(),
            max_budget_usd: z.number().optional(),
          })
          .strict(),
      )
      .default({}),
  })
  .default({});

export const ServerConfigSchema = z
  .object({
    port: z.number().optional(),
    host: z.string().default("127.0.0.1"),
  })
  .default({});

export const ToolPolicySchema = z
  .object({
    allowed: z.array(z.string()).default(["*"]),
    denied: z.array(z.string()).default([]),
    state_overrides: z
      .record(
        z.string(),
        z.object({
          allowed: z.array(z.string()).optional(),
          denied: z.array(z.string()).optional(),
        }),
      )
      .default({}),
  })
  .default({});

export const NotificationsSchema = z
  .object({
    webhook_url: z.string().optional(), // HTTP POST endpoint
    events: z
      .array(z.string())
      .default([
        "issue:completed",
        "issue:max_retries",
        "issue:circuit_breaker",
        "budget:exhausted",
      ]),
  })
  .default({});

export const WorkflowConfigSchema = z.object({
  tracker: TrackerConfigSchema,
  polling: PollingConfigSchema,
  workspace: WorkspaceConfigSchema,
  hooks: HooksConfigSchema,
  agent: AgentConfigSchema,
  claude: ClaudeConfigSchema,
  server: ServerConfigSchema,
  tool_policy: ToolPolicySchema,
  notifications: NotificationsSchema,
  prompts_dir: z.string().optional(),
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
export type TrackerConfig = z.infer<typeof TrackerConfigSchema>;
export type ClaudeConfig = z.infer<typeof ClaudeConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;
export type ToolPolicyConfig = z.infer<typeof ToolPolicySchema>;
