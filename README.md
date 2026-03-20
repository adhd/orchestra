# Orchestra

Autonomous work orchestration for Claude Code. Polls issue trackers (Linear, GitHub, GitLab), dispatches Claude Code agents to implement them, and opens pull requests -- unattended.

## Quick Start

```bash
# 1. Install
npm install && npm run build

# 2. Generate a WORKFLOW.md (interactive -- asks tracker, model, concurrency)
npx orchestra init

# 3. Set your API key
export LINEAR_API_KEY=lin_api_...

# 4. Validate the config
npx orchestra validate WORKFLOW.md

# 5. Start the daemon
npx orchestra start WORKFLOW.md --port 8080
```

To try it without any API keys:

```bash
npx orchestra init --demo
npx orchestra start WORKFLOW.md --demo --port 8080
```

## How It Works

Orchestra runs a continuous loop:

1. **Poll** -- Fetches issues from your tracker matching `active_states` (default: `Todo`, `In Progress`).
2. **Filter** -- Drops issues that are already running, blocked, in retry backoff, or past max retries. Sorts by priority.
3. **Dispatch** -- For each eligible issue (up to `max_concurrent_agents`), provisions a workspace directory and runs lifecycle hooks (`after_create`, `before_run`).
4. **Agent** -- Spawns a headless Claude Code session via the `@anthropic-ai/claude-code` SDK. The agent receives a rendered prompt (Liquid templates with issue context) and works in the provisioned workspace.
5. **Completion** -- On success, the agent's workspace contains commits ready to push. On failure, the issue enters the retry queue with exponential backoff.
6. **Reconcile** -- Each tick reconciles tracker state with local state, catching issues that were moved or closed externally.

The daemon watches `WORKFLOW.md` for changes and hot-reloads configuration without restarting.

## CLI Commands

### `orchestra start <workflow>`

Start the long-running orchestration daemon.

```bash
orchestra start WORKFLOW.md
orchestra start WORKFLOW.md --port 8080
orchestra start WORKFLOW.md --demo --dry-run
orchestra start WORKFLOW.md --once --log-level debug
orchestra start WORKFLOW.md --logs-root ./logs
```

| Flag                  | Description                                                  | Default     |
| --------------------- | ------------------------------------------------------------ | ----------- |
| `--port <number>`     | Enable HTTP dashboard on this port                           | disabled    |
| `--host <string>`     | Dashboard bind address                                       | `127.0.0.1` |
| `--log-level <level>` | `debug`, `info`, `warn`, `error`                             | `info`      |
| `--logs-root <path>`  | Directory for per-issue log files and audit trail            | none        |
| `--demo`              | Use in-memory tracker with sample issues (no API key)        | false       |
| `--dry-run`           | Fetch and display eligible issues without dispatching agents | false       |
| `--once`              | Run a single poll tick, process issues, then exit            | false       |

### `orchestra validate <workflow>`

Parse and validate a WORKFLOW.md without starting. Prints tracker type, polling interval, model, budget, and prompt length.

```bash
orchestra validate WORKFLOW.md
```

### `orchestra init`

Interactive setup. Creates a WORKFLOW.md (and `.env` if needed) in the current directory.

```bash
orchestra init            # Interactive: asks tracker, owner/repo, model, concurrency
orchestra init --demo     # Non-interactive: creates a memory-tracker config
```

### `orchestra run <workflow> --issue <id>`

Run a single issue synchronously and exit. Useful for testing prompts and debugging.

```bash
orchestra run WORKFLOW.md --issue PROJ-123
orchestra run WORKFLOW.md --issue DEMO-1 --demo --verbose
orchestra run WORKFLOW.md --issue PROJ-456 --logs-root ./logs
```

| Flag                  | Description                     |
| --------------------- | ------------------------------- |
| `--issue <id>`        | Issue identifier (required)     |
| `--verbose`           | Stream agent output to terminal |
| `--demo`              | Use in-memory tracker           |
| `--log-level <level>` | Log verbosity                   |
| `--logs-root <path>`  | Directory for log files         |

### `orchestra status`

Query a running Orchestra instance via its HTTP API.

```bash
orchestra status
orchestra status --port 9090 --host 0.0.0.0
```

Displays running/retrying/completed counts, cost, token usage, and per-worker details.

## Configuration (WORKFLOW.md)

WORKFLOW.md is a Markdown file with YAML frontmatter. The frontmatter is the configuration; the body is a Liquid template that becomes the agent prompt.

```markdown
---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
agent:
  max_concurrent_agents: 5
claude:
  model: claude-sonnet-4-6
---

You are an autonomous engineer working on **{{ issue.identifier }}**.

{{ issue.description }}
```

### tracker

| Field             | Type                                           | Default                                                    | Description                                                     |
| ----------------- | ---------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `kind`            | `"linear" \| "github" \| "gitlab" \| "memory"` | `"linear"`                                                 | Which issue tracker to poll                                     |
| `endpoint`        | `string`                                       | `"https://api.linear.app/graphql"`                         | Linear API endpoint                                             |
| `api_key`         | `string`                                       | --                                                         | Linear API key. Supports `$ENV_VAR` syntax                      |
| `project_slug`    | `string`                                       | --                                                         | Linear project slug to filter issues                            |
| `owner`           | `string`                                       | --                                                         | GitHub repository owner (required for github)                   |
| `repo`            | `string`                                       | --                                                         | GitHub repository name (required for github)                    |
| `project_path`    | `string`                                       | --                                                         | GitLab project path, e.g. `group/project` (required for gitlab) |
| `token`           | `string`                                       | --                                                         | GitLab personal access token (required for gitlab)              |
| `gitlab_endpoint` | `string`                                       | `"https://gitlab.com"`                                     | GitLab instance URL                                             |
| `active_states`   | `string[]`                                     | `["Todo", "In Progress"]`                                  | Issue states that are eligible for dispatch                     |
| `terminal_states` | `string[]`                                     | `["Done", "Canceled", "Cancelled", "Closed", "Duplicate"]` | Issue states that mean "finished"                               |

### polling

| Field         | Type     | Default | Description                                    |
| ------------- | -------- | ------- | ---------------------------------------------- |
| `interval_ms` | `number` | `30000` | Milliseconds between poll ticks. Minimum: 5000 |

### workspace

| Field  | Type     | Default                        | Description                             |
| ------ | -------- | ------------------------------ | --------------------------------------- |
| `root` | `string` | `$TMPDIR/orchestra_workspaces` | Base directory for per-issue workspaces |

### hooks

Shell commands run at workspace lifecycle points. Available environment variables: `$ISSUE_ID`, `$ISSUE_IDENTIFIER`, `$WORKSPACE_PATH`, `$REPO_URL`.

| Field           | Type     | Default | Description                                                  |
| --------------- | -------- | ------- | ------------------------------------------------------------ |
| `after_create`  | `string` | --      | Run after workspace directory is created (e.g., `git clone`) |
| `before_run`    | `string` | --      | Run before each agent session (e.g., `git pull`)             |
| `after_run`     | `string` | --      | Run after agent session completes                            |
| `before_remove` | `string` | --      | Run before workspace is cleaned up                           |
| `timeout_ms`    | `number` | `60000` | Maximum time for any hook to run                             |

### agent

| Field                            | Type                     | Default  | Description                                                         |
| -------------------------------- | ------------------------ | -------- | ------------------------------------------------------------------- |
| `max_concurrent_agents`          | `number`                 | `10`     | Maximum parallel agent sessions                                     |
| `max_turns`                      | `number`                 | `20`     | Maximum conversation turns per session                              |
| `max_retries`                    | `number`                 | `5`      | Retries before giving up on an issue                                |
| `max_retry_backoff_ms`           | `number`                 | `300000` | Maximum backoff between retries (5 min)                             |
| `max_concurrent_agents_by_state` | `Record<string, number>` | `{}`     | Per-state concurrency caps, e.g. `{"In Progress": 3}`               |
| `max_total_budget_usd`           | `number`                 | --       | Hard budget cap across all sessions. Stops dispatching when reached |
| `budget_alert_usd`               | `number`                 | --       | Fires a `budget:alert` event when crossed                           |

### claude

| Field               | Type                     | Default               | Description                                                            |
| ------------------- | ------------------------ | --------------------- | ---------------------------------------------------------------------- |
| `model`             | `string`                 | `"claude-sonnet-4-6"` | Claude model identifier                                                |
| `max_turns_per_run` | `number`                 | --                    | Turn limit passed to the Claude SDK                                    |
| `max_budget_usd`    | `number`                 | --                    | Per-session dollar budget                                              |
| `stall_timeout_ms`  | `number`                 | `600000`              | Kill session if no events for this long (10 min)                       |
| `allowed_tools`     | `string[]`               | --                    | Allowlist of tools the agent may use                                   |
| `disallowed_tools`  | `string[]`               | --                    | Denylist of tools                                                      |
| `state_overrides`   | `Record<string, object>` | `{}`                  | Per-state overrides for `model`, `max_turns_per_run`, `max_budget_usd` |

State overrides let you use different settings depending on issue state:

```yaml
claude:
  model: claude-sonnet-4-6
  state_overrides:
    "In Progress":
      model: claude-opus-4-6
      max_budget_usd: 5.00
```

### tool_policy

| Field             | Type                                  | Default | Description                             |
| ----------------- | ------------------------------------- | ------- | --------------------------------------- |
| `allowed`         | `string[]`                            | `["*"]` | Tools the agent is permitted to use     |
| `denied`          | `string[]`                            | `[]`    | Tools the agent is forbidden from using |
| `state_overrides` | `Record<string, {allowed?, denied?}>` | `{}`    | Per-state tool policy overrides         |

### notifications

| Field         | Type       | Default                                                                                 | Description                                |
| ------------- | ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| `webhook_url` | `string`   | --                                                                                      | HTTP POST endpoint for event notifications |
| `events`      | `string[]` | `["issue:completed", "issue:max_retries", "issue:circuit_breaker", "budget:exhausted"]` | Which events trigger a webhook             |

### server

| Field  | Type     | Default       | Description                                   |
| ------ | -------- | ------------- | --------------------------------------------- |
| `port` | `number` | --            | HTTP server port (also settable via `--port`) |
| `host` | `string` | `"127.0.0.1"` | HTTP server bind address                      |

### Top-level

| Field         | Type     | Default | Description                                                         |
| ------------- | -------- | ------- | ------------------------------------------------------------------- |
| `prompts_dir` | `string` | --      | Directory containing prompt layer files (`global.md`, `{state}.md`) |

## Prompt Layers

The prompt sent to each agent is assembled from up to four layers, concatenated with `---` separators:

1. **Global prompt** (`{prompts_dir}/global.md`) -- Shared instructions injected into every agent session. Set `prompts_dir` in your config to enable this.

2. **State prompt** (`{prompts_dir}/{state}.md`) -- State-specific instructions. The filename is the lowercased, hyphenated issue state (e.g., `todo.md`, `in-progress.md`). Only included if the file exists.

3. **Workflow body** (the Markdown below the YAML frontmatter in WORKFLOW.md) -- Your main prompt template. Rendered with Liquid.

4. **Lifecycle context** (auto-injected) -- Issue metadata (identifier, title, state, priority, labels, branch name, URL) and attempt number. Always appended; you do not write this.

All layers support Liquid templating with these variables:

| Variable            | Type             | Description                                    |
| ------------------- | ---------------- | ---------------------------------------------- |
| `issue.identifier`  | `string`         | e.g. `PROJ-123`                                |
| `issue.title`       | `string`         | Issue title                                    |
| `issue.description` | `string`         | Issue body                                     |
| `issue.state`       | `string`         | Current state                                  |
| `issue.priority`    | `number \| null` | Priority (1 = urgent)                          |
| `issue.labels`      | `string[]`       | Labels/tags                                    |
| `issue.branch_name` | `string`         | Suggested branch name                          |
| `issue.url`         | `string \| null` | Link back to the tracker                       |
| `attempt`           | `number \| null` | `null` on first attempt, increments on retries |

## Dashboard

When started with `--port`, Orchestra serves an HTML dashboard at the root URL and a JSON API under `/api/v1/`.

**HTML Dashboard** (`GET /`) -- Live view of running workers, retry queue, token usage, cost, and completion history. Auto-refreshes.

**API Endpoints:**

| Method | Path                                | Description                                            |
| ------ | ----------------------------------- | ------------------------------------------------------ |
| `GET`  | `/api/v1/state`                     | Full state snapshot (stats, workers, retries, tokens)  |
| `GET`  | `/api/v1/:identifier`               | Detail for a specific issue                            |
| `GET`  | `/api/v1/events`                    | SSE stream of live updates (every 3s)                  |
| `GET`  | `/api/v1/history`                   | Completion history. `?limit=50`                        |
| `POST` | `/api/v1/refresh`                   | Force an immediate poll tick                           |
| `POST` | `/api/v1/pause`                     | Pause dispatching (running workers continue)           |
| `POST` | `/api/v1/resume`                    | Resume dispatching                                     |
| `POST` | `/api/v1/issues/:identifier/cancel` | Cancel a running worker                                |
| `POST` | `/api/v1/dispatch`                  | Trigger a dispatch tick. Body: `{"identifier": "..."}` |

Error responses use a consistent envelope: `{"error": {"code": "...", "message": "..."}}`.

## Architecture

```
src/
  cli.ts                    CLI entry point (commander)
  config/
    schema.ts               Zod schemas for all configuration
    workflow-loader.ts       Parses WORKFLOW.md (gray-matter + Zod)
    workflow-watcher.ts      Watches WORKFLOW.md for hot reload
  tracker/
    linear-client.ts        Linear GraphQL polling
    github-client.ts        GitHub Issues polling
    gitlab-client.ts        GitLab Issues polling
    memory-tracker.ts       In-memory tracker for demos/tests
    *-normalizer.ts         Normalize tracker responses to NormalizedIssue
  orchestrator/
    orchestrator.ts         Main loop: poll, filter, dispatch, track
    dispatch.ts             Eligibility checks and candidate sorting
    state-machine.ts        Issue state transitions
    retry-queue.ts          Exponential backoff retry scheduling
    reconciler.ts           Sync tracker state with local state
  agent/
    agent-runner.ts         Spawns Claude Code via SDK
    prompt-builder.ts       4-layer prompt assembly (Liquid)
    session-tracker.ts      Token/cost accounting across sessions
    tool-policy.ts          Tool allow/deny evaluation
    circuit-breaker.ts      Per-issue circuit breaker
  workspace/
    workspace-manager.ts    Creates/removes per-issue directories
    hooks.ts                Shell hook execution
    path-safety.ts          Path traversal prevention
  observability/
    http-server.ts          Fastify dashboard + API
    dashboard.ts            HTML dashboard rendering
    logger.ts               Pino logger setup
    agent-logger.ts         Per-issue file logging
    audit-trail.ts          JSONL audit log
    history.ts              Completion history
    notifier.ts             Webhook notifications
  events/
    event-bus.ts            Internal pub/sub for cross-component events
```

Key dependencies: `@anthropic-ai/claude-code` (agent SDK), `commander` (CLI), `fastify` (HTTP), `gray-matter` (frontmatter parsing), `liquidjs` (prompt templating), `zod` (config validation), `pino` (logging).

## Environment Variables

```bash
LINEAR_API_KEY=lin_api_...       # Required for Linear tracker
GITLAB_TOKEN=glpat-...           # Required for GitLab tracker
REPO_URL=https://github.com/...  # Available in hooks for git clone
```

String values in WORKFLOW.md that start with `$` are resolved from environment variables (e.g., `api_key: $LINEAR_API_KEY`).

## Compared to Symphony

[Symphony](https://github.com/anthropics/symphony) is Anthropic's reference implementation for multi-agent orchestration. Orchestra builds on the same foundation with different priorities:

|                          | Orchestra                                                  | Symphony             |
| ------------------------ | ---------------------------------------------------------- | -------------------- |
| **Tracker integration**  | Built-in polling for Linear, GitHub, GitLab                | BYO task source      |
| **Lifecycle**            | Long-running daemon with continuous polling                | Single-run execution |
| **Configuration**        | Single WORKFLOW.md file (YAML frontmatter + prompt)        | Python configuration |
| **Retry/backoff**        | Automatic exponential backoff with circuit breakers        | Manual               |
| **Observability**        | HTTP dashboard, SSE events, JSONL audit trail, webhooks    | Logging              |
| **Hot reload**           | Watches WORKFLOW.md and applies changes without restart    | Requires restart     |
| **Workspace management** | Auto-provisions per-issue directories with lifecycle hooks | Manual setup         |
| **Budget controls**      | Per-session and global budget caps with alerts             | Per-session via SDK  |
| **State-aware config**   | Different models/tools/budgets per issue state             | Uniform config       |

Orchestra is opinionated about the workflow (poll tracker, dispatch agent, retry on failure) while Symphony is a general-purpose orchestration framework. If your use case fits the poll-dispatch-PR loop, Orchestra handles the plumbing. If you need custom multi-agent topologies, Symphony gives you more flexibility.
