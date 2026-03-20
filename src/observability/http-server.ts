import Fastify from "fastify";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { WorkerEntry } from "../types/index.js";
import type { Logger } from "pino";
import { renderDashboard } from "./dashboard.js";

function serializeWorker(w: WorkerEntry) {
  return {
    issue_id: w.issue.id,
    identifier: w.issue.identifier,
    title: w.issue.title,
    state: w.runAttemptState,
    attempt: w.attempt,
    turn_count: w.turnCount,
    session_id: w.sessionId,
    started_at: new Date(w.startedAt).toISOString(),
    last_event_at: new Date(w.lastEventAt).toISOString(),
    token_usage: w.tokenUsage,
  };
}

export async function startHttpServer(
  orchestrator: Orchestrator,
  host: string,
  port: number,
  logger: Logger,
): Promise<void> {
  const app = Fastify({ logger: false });

  // HTML Dashboard
  app.get("/", async (_req, reply) => {
    const stats = orchestrator.getStats();
    const workers = orchestrator.getRunningWorkers();
    const retries = orchestrator.getRetryQueue();
    const tokens = orchestrator.getSessionTracker().getAggregateTokens();

    const history = orchestrator.getHistory(10);
    const html = renderDashboard({ stats, workers, retries, tokens, history });
    reply.type("text/html").send(html);
  });

  // JSON API: Full state snapshot
  app.get("/api/v1/state", async () => {
    const stats = orchestrator.getStats();
    const workers = orchestrator.getRunningWorkers().map(serializeWorker);
    const retries = orchestrator.getRetryQueue();
    const tokens = orchestrator.getSessionTracker().getAggregateTokens();

    return { stats, workers, retries, tokens };
  });

  // Per-issue detail endpoint
  app.get("/api/v1/:identifier", async (req, reply) => {
    const identifier = (req.params as { identifier: string }).identifier;
    const workers = orchestrator.getRunningWorkers();
    const worker = workers.find((w) => w.issue.identifier === identifier);
    const retries = orchestrator.getRetryQueue();
    const retry = retries.find((r) => r.identifier === identifier);

    if (!worker && !retry) {
      reply.status(404);
      return {
        error: { code: "not_found", message: `Issue ${identifier} not found` },
      };
    }

    return {
      identifier,
      ...(worker
        ? {
            status: "running",
            issue_id: worker.issue.id,
            title: worker.issue.title,
            state: worker.runAttemptState,
            attempt: worker.attempt,
            turn_count: worker.turnCount,
            session_id: worker.sessionId,
            started_at: new Date(worker.startedAt).toISOString(),
            last_event_at: new Date(worker.lastEventAt).toISOString(),
            token_usage: worker.tokenUsage,
          }
        : {}),
      ...(retry
        ? {
            status: "retrying",
            attempt: retry.attempt,
            due_at: new Date(retry.dueAtMs).toISOString(),
            error: retry.error,
          }
        : {}),
    };
  });

  // SSE endpoint for live updates
  app.get("/api/v1/events", async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendUpdate = () => {
      const stats = orchestrator.getStats();
      const workers = orchestrator.getRunningWorkers().map(serializeWorker);
      const retries = orchestrator.getRetryQueue();
      const tokens = orchestrator.getSessionTracker().getAggregateTokens();

      const data = JSON.stringify({ stats, workers, retries, tokens });
      reply.raw.write(`data: ${data}\n\n`);
    };

    // Send initial state
    sendUpdate();

    // Send updates every 3 seconds
    const interval = setInterval(sendUpdate, 3000);

    // Cleanup on disconnect
    req.raw.on("close", () => {
      clearInterval(interval);
    });
  });

  // Completion history
  app.get("/api/v1/history", async (req) => {
    const limit = parseInt((req.query as { limit?: string }).limit ?? "50", 10);
    return orchestrator.getHistory(limit);
  });

  // Force immediate poll
  app.post("/api/v1/refresh", async () => {
    await orchestrator.forceTick();
    return { ok: true };
  });

  // Pause orchestrator (existing workers continue, no new dispatches)
  app.post("/api/v1/pause", async () => {
    orchestrator.pause();
    return { ok: true, paused: true };
  });

  // Resume orchestrator
  app.post("/api/v1/resume", async () => {
    orchestrator.resume();
    return { ok: true, paused: false };
  });

  // Cancel a specific running worker
  app.post("/api/v1/issues/:identifier/cancel", async (req, reply) => {
    const identifier = (req.params as { identifier: string }).identifier;
    const canceled = orchestrator.cancelWorker(identifier);
    if (!canceled) {
      reply.status(404);
      return {
        error: {
          code: "not_found",
          message: `No running worker for ${identifier}`,
        },
      };
    }
    return { ok: true, identifier, canceled: true };
  });

  // Force dispatch (trigger immediate tick)
  app.post("/api/v1/dispatch", async () => {
    await orchestrator.forceTick();
    return { ok: true, message: "Poll tick triggered" };
  });

  // Global error handler with error envelope format
  app.setErrorHandler(async (error, _req, reply) => {
    reply.status(500).send({
      error: { code: "internal_error", message: error.message },
    });
  });

  await app.listen({ host, port });
  logger.info({ host, port }, "Dashboard available");
}
