# Orchestra

Orchestra is an autonomous work orchestrator for Claude Code. It polls issue trackers (Linear, GitHub, GitLab), dispatches Claude Code agent sessions to work on issues in isolated workspaces, and manages the full lifecycle: claiming, retries, stall detection, budget limits, and reconciliation. Built for teams that want hands-off issue resolution.

## Architecture

```
src/
  config/          Config loading and validation
    schema.ts        Zod schemas for all config sections (WorkflowConfigSchema)
    workflow-loader.ts  Parses WORKFLOW.md (YAML frontmatter + LiquidJS body)
    workflow-watcher.ts Hot-reload on file change
    error-formatter.ts  Human-readable config errors

  tracker/         Issue tracker integrations (all implement TrackerClient)
    linear-client.ts    Linear GraphQL
    github-client.ts    GitHub Issues via REST
    gitlab-client.ts    GitLab Issues via REST
    memory-tracker.ts   In-memory tracker for demos/tests

  orchestrator/    Core scheduling loop
    orchestrator.ts     Main class: poll tick, dispatch, worker lifecycle
    state-machine.ts    Pure function transitions for IssueOrcState
    dispatch.ts         Eligibility checks + priority sorting
    retry-queue.ts      Exponential backoff retry scheduling
    reconciler.ts       Detects externally-closed issues, cancels workers

  workspace/       Per-issue git worktree management
    workspace-manager.ts  Create/cleanup isolated dirs for each agent

  agent/           Claude Code SDK integration
    agent-runner.ts     Calls @anthropic-ai/claude-code query() SDK
    prompt-builder.ts   4-layer prompt: global.md + {state}.md + WORKFLOW.md body + lifecycle
    session-tracker.ts  Maps issues to session IDs for resumption
    circuit-breaker.ts  Trips on repeated tool failures
    tool-policy.ts      Allowed/denied tool lists, per-state overrides

  observability/   Monitoring and logging
    http-server.ts      Fastify dashboard: GET /api/v1/state, /api/v1/history
    logger.ts           Pino structured logger factory
    agent-logger.ts     Per-issue log files
    audit-trail.ts      Append-only JSONL audit log
    history.ts          Completed-issue history log
    notifier.ts         Webhook notifications on events

  events/          Decoupled communication
    event-bus.ts        Typed EventEmitter (OrchestraEvents interface)

  types/index.ts   Shared types: IssueOrcState, RunAttemptState, TrackerClient, etc.
  cli.ts           Commander CLI: start, run, validate, init, status
  index.ts         Entry point
```

## Key Design Decisions

- **State machine enforced.** All issue state transitions go through `transition()` in `state-machine.ts`. States: unclaimed -> claimed -> running -> retry_queued -> released. Never mutate `issueStates` directly.
- **Sequential ticks.** The poll loop uses `setTimeout` (not `setInterval`) so ticks never overlap. Next tick schedules only after the current one completes.
- **TrackerClient interface.** Two methods: `fetchCandidateIssues()` and `fetchIssueStatesByIds()`. Add new trackers by implementing this interface.
- **4-layer prompt assembly.** `buildFullPrompt()` merges: (1) `prompts/global.md`, (2) `prompts/{state}.md`, (3) WORKFLOW.md body rendered with LiquidJS, (4) lifecycle context (attempt number, continuation).
- **EventBus for loose coupling.** Orchestrator emits typed events; notifier, audit trail, and HTTP server subscribe independently. See `OrchestraEvents` in `event-bus.ts` for the full event catalog.
- **Circuit breaker pattern.** `CircuitBreaker` in `agent/circuit-breaker.ts` trips when an agent repeatedly fails on a specific tool, preventing infinite retry loops.
- **Reconciler.** Each tick checks if tracked issues moved to terminal states externally (e.g., closed in Linear) and cancels their workers.

## Development

```bash
npm test                              # vitest run (all tests)
npm run test:unit                     # unit tests only
npm run test:integration              # integration tests only
npm run dev -- start WORKFLOW.md      # run orchestrator via tsx
npm run dev -- init --demo            # generate demo WORKFLOW.md (no API keys needed)
npm run dev -- validate WORKFLOW.md   # check config validity
npm run dev -- run WORKFLOW.md --issue DEMO-1 --demo  # run single issue
npm run dev -- status --port 8080     # check running instance
npm run build                         # tsc compile to dist/
npm run lint                          # tsc --noEmit type check
```

## Testing Conventions

- Unit tests in `test/unit/`, integration in `test/integration/`, e2e in `test/e2e/`.
- The Claude Code SDK is globally mocked via vitest `resolve.alias` in `vitest.config.ts` pointing to `test/__mocks__/@anthropic-ai/claude-code.ts`. You do not need to `vi.mock` it manually.
- Mock the agent runner (`vi.mock("../agent/agent-runner.js")`) for orchestrator-level tests.
- Use real temp directories (`fs.mkdtempSync`) for workspace tests.
- Create test loggers with `pino({ level: "silent" })`.
- Test timeout is 30s, hook timeout is 10s.

## Code Conventions

- ESM modules throughout. Always use `.js` extensions in import paths (TypeScript compiles `.ts` to `.js`).
- Zod for all config validation (`src/config/schema.ts`). Config types are inferred with `z.infer<>`.
- Pino for structured logging. Never use `console.log` in library code (CLI output is the exception).
- LiquidJS for template rendering in prompts. Template variables: `{{ issue.identifier }}`, `{{ issue.title }}`, `{{ issue.description }}`, `{{ attempt }}`.
- All state transitions through `transition()` or `canTransition()` in `state-machine.ts`. Throws `InvalidTransitionError` on illegal transitions.
- Config lives in WORKFLOW.md as YAML frontmatter. The markdown body is the prompt template.

## Common Tasks

**Add a new tracker:** Implement `TrackerClient` interface (two methods: `fetchCandidateIssues`, `fetchIssueStatesByIds`). Add the kind to the `kind` enum in `TrackerConfigSchema` in `schema.ts`. Add tracker-specific fields to `TrackerConfigSchema`. Wire it up in `createTracker()` in `cli.ts`.

**Add a new event:** Add the event name and payload type to `OrchestraEvents` in `src/events/event-bus.ts`. Emit it with `this.eventBus?.emit("event:name", payload)` in the orchestrator. Optionally add it to the default notification events in `NotificationsSchema`.

**Add a config field:** Add the Zod field to the appropriate schema in `src/config/schema.ts`. Thread the value through `OrchestratorOptions` or read it from `this.config` in the orchestrator. The type updates automatically via `z.infer<>`.

**Add a CLI command:** Add a new `.command()` chain in `createCli()` in `src/cli.ts` using Commander. Follow the pattern of existing commands (load workflow, create logger, etc.).

**Add a prompt layer:** Extend `buildFullPrompt()` in `src/agent/prompt-builder.ts`. The function concatenates string parts in order; insert your layer at the appropriate position.
