import path from "node:path";
import readline from "node:readline";
import fs from "node:fs";
import { Command } from "commander";
import { loadWorkflow } from "./config/workflow-loader.js";
import { WorkflowWatcher } from "./config/workflow-watcher.js";
import { LinearClient } from "./tracker/linear-client.js";
import { GitHubClient } from "./tracker/github-client.js";
import { GitLabClient } from "./tracker/gitlab-client.js";
import { MemoryTracker } from "./tracker/memory-tracker.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { startHttpServer } from "./observability/http-server.js";
import { createLogger } from "./observability/logger.js";
import { AgentFileLogger } from "./observability/agent-logger.js";
import { Notifier } from "./observability/notifier.js";
import { HistoryLog } from "./observability/history.js";
import { EventBus } from "./events/event-bus.js";
import { formatError } from "./config/error-formatter.js";
import { isEligible, sortCandidates } from "./orchestrator/dispatch.js";
import { buildFullPrompt } from "./agent/prompt-builder.js";
import type { Logger } from "pino";
import type { TrackerClient, NormalizedIssue } from "./types/index.js";

function createDemoTracker(logger: Logger): MemoryTracker {
  const tracker = new MemoryTracker();
  const now = new Date().toISOString();

  const sampleIssues: NormalizedIssue[] = [
    {
      id: "demo-1",
      identifier: "DEMO-1",
      title: "Set up project README",
      description: "Create a comprehensive README with setup instructions.",
      priority: 1,
      state: "Todo",
      labels: ["documentation"],
      blocked_by: [],
      created_at: now,
      updated_at: now,
      branch_name: "demo-1-readme",
      url: null,
    },
    {
      id: "demo-2",
      identifier: "DEMO-2",
      title: "Add input validation",
      description: "Validate user input on the settings form.",
      priority: 2,
      state: "Todo",
      labels: ["enhancement"],
      blocked_by: [],
      created_at: now,
      updated_at: now,
      branch_name: "demo-2-validation",
      url: null,
    },
    {
      id: "demo-3",
      identifier: "DEMO-3",
      title: "Fix date formatting bug",
      description: "Dates display incorrectly in the activity feed.",
      priority: 1,
      state: "In Progress",
      labels: ["bug"],
      blocked_by: [],
      created_at: now,
      updated_at: now,
      branch_name: "demo-3-date-fix",
      url: null,
    },
  ];

  for (const issue of sampleIssues) {
    tracker.addIssue(issue);
  }

  logger.info(
    { issueCount: sampleIssues.length },
    "Running in demo mode with in-memory tracker",
  );

  return tracker;
}

/**
 * Create a tracker client from workflow config and CLI options.
 */
function createTracker(
  config: ReturnType<typeof loadWorkflow>["config"],
  demo: boolean | undefined,
  logger: Logger,
): TrackerClient {
  if (demo) {
    return createDemoTracker(logger);
  }

  if (config.tracker.kind === "github") {
    if (!config.tracker.owner || !config.tracker.repo) {
      logger.fatal("GitHub tracker requires 'owner' and 'repo' in config");
      process.exit(1);
    }
    return new GitHubClient({
      owner: config.tracker.owner,
      repo: config.tracker.repo,
      active_labels: config.tracker.active_states,
      terminal_labels: config.tracker.terminal_states,
    });
  }

  if (config.tracker.kind === "gitlab") {
    if (!config.tracker.project_path || !config.tracker.token) {
      logger.fatal(
        "GitLab tracker requires 'project_path' and 'token' in config",
      );
      process.exit(1);
    }
    return new GitLabClient({
      endpoint: config.tracker.gitlab_endpoint,
      token: config.tracker.token,
      project_path: config.tracker.project_path,
      active_labels: config.tracker.active_states,
      terminal_labels: config.tracker.terminal_states,
    });
  }

  if (config.tracker.kind === "memory") {
    return createDemoTracker(logger);
  }

  return new LinearClient(config.tracker);
}

/**
 * Generate WORKFLOW.md content from configuration values.
 */
function generateWorkflowContent(
  trackerConfig: Record<string, unknown>,
  maxAgents: string,
  model: string,
): string {
  const tracker = trackerConfig as Record<string, string>;
  const kind = tracker.kind ?? "linear";

  let trackerYaml = `  kind: "${kind}"`;
  if (kind === "linear") {
    trackerYaml += `\n  api_key: "$LINEAR_API_KEY"`;
    if (tracker.project_slug) {
      trackerYaml += `\n  project_slug: "${tracker.project_slug}"`;
    }
  } else if (kind === "github") {
    trackerYaml += `\n  owner: "${tracker.owner ?? ""}"`;
    trackerYaml += `\n  repo: "${tracker.repo ?? ""}"`;
  } else if (kind === "gitlab") {
    trackerYaml += `\n  project_path: "${tracker.project_path ?? ""}"`;
    trackerYaml += `\n  token: "$GITLAB_TOKEN"`;
  }

  return `---
tracker:
${trackerYaml}
agent:
  max_concurrent_agents: ${maxAgents}
claude:
  model: "${model}"
---

You are an autonomous coding agent. You have been assigned the following issue:

**{{ issue.identifier }}: {{ issue.title }}**

{{ issue.description }}

## Instructions

1. Read the issue carefully and understand the requirements.
2. Explore the codebase to understand the relevant code.
3. Implement the changes needed to resolve the issue.
4. Write or update tests as appropriate.
5. Verify your changes compile and tests pass.
`;
}

/**
 * Generate a demo WORKFLOW.md for the memory tracker (no external services).
 */
function generateDemoWorkflowContent(): string {
  return `---
tracker:
  kind: "memory"
agent:
  max_concurrent_agents: 2
claude:
  model: "claude-sonnet-4-6"
---

You are an autonomous coding agent running in demo mode.

**{{ issue.identifier }}: {{ issue.title }}**

{{ issue.description }}

## Instructions

1. Read the issue carefully and understand the requirements.
2. Explore the codebase to understand the relevant code.
3. Implement the changes needed to resolve the issue.
4. Write or update tests as appropriate.
5. Verify your changes compile and tests pass.
`;
}

interface StartOpts {
  port?: number;
  host: string;
  logLevel: string;
  logsRoot?: string;
  demo?: boolean;
  dryRun?: boolean;
  once?: boolean;
}

export function createCli(): Command {
  const program = new Command();

  program
    .name("orchestra")
    .description("Autonomous work orchestration for Claude Code")
    .version("0.1.0");

  // ── start subcommand (default) ──────────────────────────────────────

  const startCmd = program
    .command("start <workflow>", { isDefault: true })
    .description("Start the orchestration daemon (long-running)")
    .option("--port <number>", "Enable HTTP dashboard on this port", parseInt)
    .option("--host <string>", "HTTP dashboard bind address", "127.0.0.1")
    .option(
      "--log-level <level>",
      "Log level (debug, info, warn, error)",
      "info",
    )
    .option("--logs-root <path>", "Directory for log files")
    .option("--demo", "Run with in-memory tracker (no Linear API key needed)")
    .option("--dry-run", "Show what would be dispatched without running agents")
    .option("--once", "Run a single poll tick, process all issues, then exit")
    .action(async (workflowPath: string, opts: StartOpts) => {
      const logger = createLogger(opts.logLevel);

      let workflow;
      try {
        workflow = loadWorkflow(workflowPath);
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }

      logger.info({ path: workflowPath }, "Workflow loaded");

      const tracker = createTracker(workflow.config, opts.demo, logger);

      // ── --dry-run mode ──────────────────────────────────────────────
      if (opts.dryRun) {
        console.log("Dry run: fetching candidate issues...\n");

        let candidates: NormalizedIssue[];
        try {
          candidates = await tracker.fetchCandidateIssues(
            workflow.config.tracker.active_states,
          );
        } catch (err) {
          console.error(`Failed to fetch candidates: ${formatError(err)}`);
          process.exit(1);
        }

        const sorted = sortCandidates(candidates);
        const runningMap = new Map();
        const retryMap = { has: () => false };
        const claimedSet = new Set<string>();

        let count = 0;
        for (const issue of sorted) {
          if (
            isEligible(
              issue,
              workflow.config.tracker.active_states,
              runningMap,
              retryMap,
              claimedSet,
              workflow.config.agent,
            )
          ) {
            count++;
            let promptPreview: string;
            try {
              const prompt = await buildFullPrompt(workflow.promptTemplate, {
                issue,
                attempt: null,
              });
              promptPreview = prompt.slice(0, 200);
              if (prompt.length > 200) promptPreview += "...";
            } catch {
              promptPreview = "(prompt render failed)";
            }

            console.log(
              `${issue.identifier}  ${issue.title}  (priority: ${issue.priority ?? "none"})`,
            );
            console.log(`  ${promptPreview}\n`);
          }
        }

        if (count === 0) {
          console.log("No eligible issues found.");
        } else {
          console.log(`${count} issue(s) would be dispatched.`);
        }
        process.exit(0);
      }

      // Create per-issue agent logger if logs root specified
      const agentLogger = opts.logsRoot
        ? new AgentFileLogger(opts.logsRoot)
        : undefined;

      const auditFilePath = opts.logsRoot
        ? path.join(opts.logsRoot, "audit.jsonl")
        : undefined;

      // Create event bus for notifications and inter-component communication
      const eventBus = new EventBus();

      // Create history log
      const historyFilePath = opts.logsRoot
        ? path.join(opts.logsRoot, "history.jsonl")
        : path.join(workflow.config.workspace.root, "history.jsonl");
      const historyLog = new HistoryLog(historyFilePath);

      const orchestrator = new Orchestrator({
        config: workflow.config,
        promptTemplate: workflow.promptTemplate,
        tracker,
        logger,
        agentLogger,
        auditFilePath,
        eventBus,
        historyLog,
      });

      // Start webhook notifier if configured
      if (workflow.config.notifications?.webhook_url) {
        const notifier = new Notifier(
          {
            webhookUrl: workflow.config.notifications.webhook_url,
            events: workflow.config.notifications.events,
          },
          eventBus,
          logger,
        );
        notifier.start();
      }

      // ── --once mode ─────────────────────────────────────────────────
      if (opts.once) {
        logger.info("Running single poll tick (--once)");
        await orchestrator.start();

        // Give the tick time to dispatch, then wait for workers
        // We stop immediately after the first tick completes
        // by using a small delay then stopping
        await new Promise((resolve) =>
          setTimeout(resolve, workflow.config.polling.interval_ms + 1000),
        );
        await orchestrator.stop();
        process.exit(0);
      }

      // ── Normal daemon mode ──────────────────────────────────────────

      // Watch for workflow changes
      const watcher = new WorkflowWatcher(workflowPath, workflow);
      watcher.on("reload", (next) => {
        logger.info("Workflow reloaded");
        orchestrator.updateConfig(next.config, next.promptTemplate);
      });
      watcher.on("error", (err) => {
        logger.error(
          { error: err.message },
          "Workflow reload failed, keeping current config",
        );
      });
      watcher.start();

      // Start HTTP server if port specified
      const port = opts.port ?? workflow.config.server.port;
      if (port) {
        const host = opts.host ?? workflow.config.server.host;
        await startHttpServer(orchestrator, host, port, logger);
      }

      // Start orchestrator
      await orchestrator.start();

      // Graceful shutdown
      const shutdown = async () => {
        logger.info("Shutting down...");
        watcher.stop();
        await orchestrator.stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  // ── validate subcommand ─────────────────────────────────────────────

  program
    .command("validate <workflow>")
    .description("Validate a WORKFLOW.md file without starting")
    .action(async (workflowPath: string) => {
      try {
        const workflow = loadWorkflow(workflowPath);
        const config = workflow.config;

        // Check tracker-specific requirements
        if (config.tracker.kind === "linear" && !config.tracker.api_key) {
          console.error(
            "Error: Linear tracker requires 'api_key' (or $LINEAR_API_KEY)",
          );
          process.exit(1);
        }
        if (
          config.tracker.kind === "github" &&
          (!config.tracker.owner || !config.tracker.repo)
        ) {
          console.error("Error: GitHub tracker requires 'owner' and 'repo'");
          process.exit(1);
        }
        if (
          config.tracker.kind === "gitlab" &&
          (!config.tracker.project_path || !config.tracker.token)
        ) {
          console.error(
            "Error: GitLab tracker requires 'project_path' and 'token'",
          );
          process.exit(1);
        }

        console.log("Config valid");
        console.log(`  Tracker: ${config.tracker.kind}`);
        console.log(`  Polling: every ${config.polling.interval_ms / 1000}s`);
        console.log(`  Max agents: ${config.agent.max_concurrent_agents}`);
        console.log(`  Max retries: ${config.agent.max_retries}`);
        console.log(`  Model: ${config.claude.model}`);
        if (config.claude.max_budget_usd) {
          console.log(`  Budget per session: $${config.claude.max_budget_usd}`);
        }
        console.log(
          `  Prompt template: ${workflow.promptTemplate.length} chars`,
        );
        process.exit(0);
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  // ── init subcommand ─────────────────────────────────────────────────

  program
    .command("init")
    .description("Create a new WORKFLOW.md configuration")
    .option("--demo", "Create a demo config (no external services needed)")
    .action(async (opts: { demo?: boolean }) => {
      const targetPath = path.resolve("WORKFLOW.md");

      if (fs.existsSync(targetPath)) {
        console.error(
          `WORKFLOW.md already exists at ${targetPath}. Remove it first or use a different directory.`,
        );
        process.exit(1);
      }

      if (opts.demo) {
        fs.writeFileSync(targetPath, generateDemoWorkflowContent(), "utf-8");
        console.log("Created WORKFLOW.md (demo mode with memory tracker)");
        console.log("\nNext steps:");
        console.log("  1. Run: orchestra validate WORKFLOW.md");
        console.log("  2. Run: orchestra start WORKFLOW.md --demo --port 8080");
        return;
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ask = (q: string): Promise<string> =>
        new Promise((r) => rl.question(q, r));

      console.log("Orchestra Setup\n");

      const kind =
        (await ask("Tracker (linear/github/gitlab) [linear]: ")) || "linear";

      let trackerConfig: Record<string, unknown> = { kind };

      if (kind === "linear") {
        const slug = await ask("Linear project slug: ");
        trackerConfig = {
          kind: "linear",
          api_key: "$LINEAR_API_KEY",
          project_slug: slug,
        };
      } else if (kind === "github") {
        const owner = await ask("GitHub owner: ");
        const repo = await ask("GitHub repo: ");
        trackerConfig = { kind: "github", owner, repo };
      } else if (kind === "gitlab") {
        const projectPath = await ask(
          "GitLab project path (e.g., group/project): ",
        );
        trackerConfig = {
          kind: "gitlab",
          project_path: projectPath,
          token: "$GITLAB_TOKEN",
        };
      }

      const maxAgents = (await ask("Max concurrent agents [5]: ")) || "5";
      const model =
        (await ask("Claude model [claude-sonnet-4-6]: ")) ||
        "claude-sonnet-4-6";

      rl.close();

      // Generate WORKFLOW.md
      const content = generateWorkflowContent(trackerConfig, maxAgents, model);
      fs.writeFileSync(targetPath, content, "utf-8");

      // Generate .env if tracker needs env vars
      const envPath = path.resolve(".env");
      const envLines: string[] = [];
      if (kind === "linear") {
        envLines.push("LINEAR_API_KEY=your-linear-api-key-here");
      } else if (kind === "gitlab") {
        envLines.push("GITLAB_TOKEN=your-gitlab-token-here");
      }

      if (envLines.length > 0 && !fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, envLines.join("\n") + "\n", "utf-8");
        console.log("\nCreated .env");
      }

      console.log("Created WORKFLOW.md");
      console.log("\nNext steps:");
      if (envLines.length > 0) {
        console.log("  1. Set your API key in .env");
        console.log("  2. Run: orchestra validate WORKFLOW.md");
        console.log("  3. Run: orchestra start WORKFLOW.md --port 8080");
      } else {
        console.log("  1. Run: orchestra validate WORKFLOW.md");
        console.log("  2. Run: orchestra start WORKFLOW.md --port 8080");
      }
    });

  // ── run subcommand (single issue) ───────────────────────────────────

  program
    .command("run <workflow>")
    .description("Run a single issue and exit")
    .requiredOption("--issue <id>", "Issue identifier to process")
    .option("--verbose", "Stream agent output to terminal")
    .option(
      "--log-level <level>",
      "Log level (debug, info, warn, error)",
      "info",
    )
    .option("--demo", "Run with in-memory tracker")
    .option("--logs-root <path>", "Directory for log files")
    .action(
      async (
        workflowPath: string,
        opts: {
          issue: string;
          verbose?: boolean;
          logLevel: string;
          demo?: boolean;
          logsRoot?: string;
        },
      ) => {
        const logger = createLogger(opts.logLevel);

        let workflow;
        try {
          workflow = loadWorkflow(workflowPath);
        } catch (err) {
          console.error(formatError(err));
          process.exit(1);
        }

        const tracker = createTracker(workflow.config, opts.demo, logger);

        // Fetch candidates and find the requested issue
        let candidates: NormalizedIssue[];
        try {
          candidates = await tracker.fetchCandidateIssues(
            workflow.config.tracker.active_states,
          );
        } catch (err) {
          console.error(`Failed to fetch issues: ${formatError(err)}`);
          process.exit(1);
        }

        const issue = candidates.find(
          (c) => c.identifier === opts.issue || c.id === opts.issue,
        );

        if (!issue) {
          console.error(
            `Issue "${opts.issue}" not found among ${candidates.length} candidate(s).`,
          );
          console.error(
            "Available identifiers: " +
              candidates.map((c) => c.identifier).join(", "),
          );
          process.exit(1);
        }

        console.log(`Running issue: ${issue.identifier} - ${issue.title}\n`);

        const agentLogger = opts.logsRoot
          ? new AgentFileLogger(opts.logsRoot)
          : undefined;

        const auditFilePath = opts.logsRoot
          ? path.join(opts.logsRoot, "audit.jsonl")
          : undefined;

        // Create orchestrator for single-issue run
        const orchestrator = new Orchestrator({
          config: {
            ...workflow.config,
            agent: {
              ...workflow.config.agent,
              max_concurrent_agents: 1,
            },
          },
          promptTemplate: workflow.promptTemplate,
          tracker,
          logger,
          agentLogger,
          auditFilePath,
        });

        await orchestrator.start();

        // Wait for the single issue to complete
        // Poll until the worker finishes
        const pollInterval = setInterval(() => {
          const stats = orchestrator.getStats();
          if (stats.running === 0 && stats.retrying === 0) {
            clearInterval(pollInterval);
            orchestrator.stop().then(() => {
              console.log("\nRun complete.");
              process.exit(0);
            });
          }
        }, 1000);

        // Safety timeout based on stall timeout + margin
        const timeoutMs = workflow.config.claude.stall_timeout_ms + 30_000;
        setTimeout(() => {
          clearInterval(pollInterval);
          console.error(`\nTimed out after ${timeoutMs / 1000}s.`);
          orchestrator.stop().then(() => process.exit(1));
        }, timeoutMs);
      },
    );

  // ── status subcommand ───────────────────────────────────────────────

  program
    .command("status")
    .description("Show status of a running Orchestra instance")
    .option("--port <number>", "Port of the running instance", parseInt, 8080)
    .option("--host <string>", "Host of the running instance", "127.0.0.1")
    .action(async (opts: { port: number; host: string }) => {
      try {
        const res = await fetch(
          `http://${opts.host}:${opts.port}/api/v1/state`,
        );
        if (!res.ok) {
          console.error(
            `Orchestra returned HTTP ${res.status} ${res.statusText}`,
          );
          process.exit(1);
        }

        const data = (await res.json()) as {
          stats: { running: number; retrying: number; released: number };
          tokens: {
            costUSD: number;
            input: number;
            output: number;
          };
          workers: Array<{
            identifier: string;
            state: string;
            attempt: number;
            turn_count: number;
            token_usage: { costUSD: number };
          }>;
          retries: Array<{
            identifier: string;
            attempt: number;
            error: string | null;
          }>;
        };

        console.log(`Orchestra Status (${opts.host}:${opts.port})\n`);
        console.log(
          `Running: ${data.stats.running}  Retrying: ${data.stats.retrying}  Completed: ${data.stats.released}`,
        );
        console.log(
          `Cost: $${data.tokens.costUSD.toFixed(2)}  Tokens: ${data.tokens.input + data.tokens.output}\n`,
        );

        if (data.workers.length > 0) {
          console.log("Workers:");
          for (const w of data.workers) {
            console.log(
              `  ${w.identifier} | ${w.state} | attempt ${w.attempt} | ${w.turn_count} turns | $${w.token_usage.costUSD.toFixed(4)}`,
            );
          }
        }

        if (data.retries.length > 0) {
          console.log("\nRetry Queue:");
          for (const r of data.retries) {
            console.log(
              `  ${r.identifier} | attempt ${r.attempt} | ${r.error ?? "continuation"}`,
            );
          }
        }
      } catch {
        console.error(
          `Cannot connect to Orchestra at ${opts.host}:${opts.port}`,
        );
        console.error(
          "Is Orchestra running? Start it with: orchestra start WORKFLOW.md --port 8080",
        );
        process.exit(1);
      }
    });

  return program;
}

// Export helpers for testing
export { generateWorkflowContent, generateDemoWorkflowContent };
