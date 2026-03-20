import { EventEmitter } from "node:events";

/**
 * Typed event definitions for Orchestra.
 */
export interface OrchestraEvents {
  "issue:dispatched": { issueId: string; identifier: string; attempt: number };
  "issue:completed": {
    issueId: string;
    identifier: string;
    success: boolean;
    sessionId: string | null;
  };
  "issue:failed": {
    issueId: string;
    identifier: string;
    error: string;
    attempt: number;
  };
  "issue:retry_scheduled": {
    issueId: string;
    identifier: string;
    attempt: number;
    reason: "continuation" | "failure";
    delayMs: number;
  };
  "issue:max_retries": { issueId: string; identifier: string; attempt: number };
  "issue:stalled": { issueId: string; identifier: string; elapsedMs: number };
  "issue:terminal": { issueId: string; identifier: string; state: string };
  "issue:circuit_breaker": {
    issueId: string;
    identifier: string;
    toolName: string;
  };
  "worker:started": {
    issueId: string;
    identifier: string;
    workspacePath: string;
  };
  "worker:agent_launched": {
    issueId: string;
    identifier: string;
    sessionId: string | null;
  };
  "worker:event": { issueId: string; identifier: string; eventType: string };
  "tick:start": { timestamp: number };
  "tick:complete": {
    timestamp: number;
    running: number;
    retrying: number;
    candidates: number;
  };
  "budget:alert": { spent: number; threshold: number };
  "budget:exhausted": { spent: number; limit: number };
  "issue:canceled": { issueId: string; identifier: string };
  "orchestrator:paused": Record<string, never>;
  "orchestrator:resumed": Record<string, never>;
  "config:reloaded": { timestamp: number };
  "config:reload_failed": { error: string };
  "shutdown:start": Record<string, never>;
  "shutdown:complete": Record<string, never>;
}

export type OrchestraEventName = keyof OrchestraEvents;

/**
 * Typed event bus for Orchestra system events.
 * Enables loose coupling between orchestrator, dashboard, audit trail, etc.
 */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50); // Allow many subscribers
  }

  on<E extends OrchestraEventName>(
    event: E,
    handler: (data: OrchestraEvents[E]) => void,
  ): void {
    this.emitter.on(event, handler);
  }

  once<E extends OrchestraEventName>(
    event: E,
    handler: (data: OrchestraEvents[E]) => void,
  ): void {
    this.emitter.once(event, handler);
  }

  off<E extends OrchestraEventName>(
    event: E,
    handler: (data: OrchestraEvents[E]) => void,
  ): void {
    this.emitter.off(event, handler);
  }

  emit<E extends OrchestraEventName>(event: E, data: OrchestraEvents[E]): void {
    this.emitter.emit(event, data);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
