export interface CircuitBreakerConfig {
  /** Maximum consecutive identical tool calls before tripping. Default 10. */
  maxRepeatedToolCalls: number;
  /** Number of recent tool events to track. Default 20. */
  windowSize: number;
}

export class CircuitBreaker {
  private recentTools: string[] = [];
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      maxRepeatedToolCalls: config?.maxRepeatedToolCalls ?? 10,
      windowSize: config?.windowSize ?? 20,
    };
  }

  /**
   * Record a tool use event. Returns true if the circuit should trip (agent is stuck).
   */
  recordToolUse(toolName: string): boolean {
    this.recentTools.push(toolName);

    // Keep only the window
    if (this.recentTools.length > this.config.windowSize) {
      this.recentTools.shift();
    }

    // Check if the last N calls are all the same tool
    if (this.recentTools.length >= this.config.maxRepeatedToolCalls) {
      const lastN = this.recentTools.slice(-this.config.maxRepeatedToolCalls);
      const allSame = lastN.every((t) => t === lastN[0]);
      if (allSame) return true;
    }

    return false;
  }

  /**
   * Record a non-tool event (text output, thinking). Resets repetition tracking
   * because it indicates forward progress.
   */
  recordProgress(): void {
    this.recentTools = [];
  }

  reset(): void {
    this.recentTools = [];
  }
}
