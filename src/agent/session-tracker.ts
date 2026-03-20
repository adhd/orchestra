import type { TokenUsage } from "../types/index.js";

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
  private completedSessions: SessionInfo[] = [];

  start(sessionId: string, issueId: string, identifier: string): void {
    this.sessions.set(sessionId, {
      sessionId,
      issueId,
      identifier,
      startedAt: Date.now(),
      turnCount: 0,
      tokenUsage: { input: 0, output: 0, cacheRead: 0, costUSD: 0 },
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
      this.completedSessions.push(session);
      return session;
    }
    return undefined;
  }

  getAggregateTokens(): TokenUsage {
    const all = [...this.sessions.values(), ...this.completedSessions];
    return all.reduce(
      (acc, s) => ({
        input: acc.input + s.tokenUsage.input,
        output: acc.output + s.tokenUsage.output,
        cacheRead: acc.cacheRead + s.tokenUsage.cacheRead,
        costUSD: acc.costUSD + s.tokenUsage.costUSD,
      }),
      { input: 0, output: 0, cacheRead: 0, costUSD: 0 },
    );
  }
}
