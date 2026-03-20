import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "../../src/agent/circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("does not trip on varied tool calls", () => {
    const cb = new CircuitBreaker({ maxRepeatedToolCalls: 3 });
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Write")).toBe(false);
    expect(cb.recordToolUse("Bash")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Write")).toBe(false);
  });

  it("trips after N identical consecutive tool calls", () => {
    const cb = new CircuitBreaker({ maxRepeatedToolCalls: 3 });
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(true);
  });

  it("trips with default config after 10 identical calls", () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 9; i++) {
      expect(cb.recordToolUse("Bash")).toBe(false);
    }
    expect(cb.recordToolUse("Bash")).toBe(true);
  });

  it("resets on progress event", () => {
    const cb = new CircuitBreaker({ maxRepeatedToolCalls: 3 });
    cb.recordToolUse("Read");
    cb.recordToolUse("Read");
    // Progress resets the window
    cb.recordProgress();
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(true);
  });

  it("respects window size", () => {
    const cb = new CircuitBreaker({
      maxRepeatedToolCalls: 5,
      windowSize: 5,
    });
    // Fill window with varied calls then switch to uniform
    cb.recordToolUse("A");
    cb.recordToolUse("B");
    cb.recordToolUse("C");
    cb.recordToolUse("Read");
    cb.recordToolUse("Read");
    // Window is now [B, C, Read, Read, Read] after next call because windowSize=5
    // Actually let's track: after 5 calls, window = [A, B, C, Read, Read]
    // Next call shifts out A
    expect(cb.recordToolUse("Read")).toBe(false);
    // Window = [B, C, Read, Read, Read] - last 5 are not all same
    expect(cb.recordToolUse("Read")).toBe(false);
    // Window = [C, Read, Read, Read, Read] - last 5 are not all same
    expect(cb.recordToolUse("Read")).toBe(true);
    // Window = [Read, Read, Read, Read, Read] - last 5 ARE all same
  });

  it("does not trip with fewer than maxRepeatedToolCalls", () => {
    const cb = new CircuitBreaker({ maxRepeatedToolCalls: 5 });
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(false);
    // Only 4 calls, threshold is 5
    expect(cb.recordToolUse("Write")).toBe(false);
  });

  it("reset clears all state", () => {
    const cb = new CircuitBreaker({ maxRepeatedToolCalls: 3 });
    cb.recordToolUse("Read");
    cb.recordToolUse("Read");
    cb.reset();
    // After reset, starts from scratch
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(false);
    expect(cb.recordToolUse("Read")).toBe(true);
  });

  it("handles interleaved tool calls without tripping", () => {
    const cb = new CircuitBreaker({ maxRepeatedToolCalls: 3 });
    for (let i = 0; i < 20; i++) {
      // Alternate between two tools
      const tool = i % 2 === 0 ? "Read" : "Write";
      expect(cb.recordToolUse(tool)).toBe(false);
    }
  });
});
