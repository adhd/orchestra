import type { TokenUsage } from "../types/index.js";
import { emptyTokenUsage } from "../types/index.js";

export interface SessionInfo {
  sessionId: string;
  issueId: string;
  identifier: string;
  startedAt: number;
  turnCount: number;
  tokenUsage: TokenUsage;
  lastEventAt: number;
  lastEventType: string | null;
}

export class SessionTracker {
  private sessions = new Map<string, SessionInfo>();
  private completedAggregate: TokenUsage = emptyTokenUsage();

  start(sessionId: string, issueId: string, identifier: string): void {
    this.sessions.set(sessionId, {
      sessionId,
      issueId,
      identifier,
      startedAt: Date.now(),
      turnCount: 0,
      tokenUsage: emptyTokenUsage(),
      lastEventAt: Date.now(),
      lastEventType: null,
    });
  }

  updateEvent(sessionId: string, eventType: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastEventAt = Date.now();
      session.lastEventType = eventType;
    }
  }

  complete(sessionId: string): SessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.completedAggregate.input += session.tokenUsage.input;
      this.completedAggregate.output += session.tokenUsage.output;
      this.completedAggregate.cacheRead += session.tokenUsage.cacheRead;
      this.completedAggregate.costUSD += session.tokenUsage.costUSD;
      return session;
    }
    return undefined;
  }

  getAggregateTokens(): TokenUsage {
    const active = Array.from(this.sessions.values());
    return {
      input:
        this.completedAggregate.input +
        active.reduce((s, a) => s + a.tokenUsage.input, 0),
      output:
        this.completedAggregate.output +
        active.reduce((s, a) => s + a.tokenUsage.output, 0),
      cacheRead:
        this.completedAggregate.cacheRead +
        active.reduce((s, a) => s + a.tokenUsage.cacheRead, 0),
      costUSD:
        this.completedAggregate.costUSD +
        active.reduce((s, a) => s + a.tokenUsage.costUSD, 0),
    };
  }
}
