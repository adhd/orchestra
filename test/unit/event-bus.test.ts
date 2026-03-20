import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus } from "../../src/events/event-bus.js";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it("on/emit fires handler with correct data", () => {
    const handler = vi.fn();
    bus.on("issue:dispatched", handler);
    bus.emit("issue:dispatched", {
      issueId: "i1",
      identifier: "PRJ-1",
      attempt: 0,
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      issueId: "i1",
      identifier: "PRJ-1",
      attempt: 0,
    });
  });

  it("once fires only once", () => {
    const handler = vi.fn();
    bus.once("issue:completed", handler);
    const data = {
      issueId: "i1",
      identifier: "PRJ-1",
      success: true,
      sessionId: "s1",
    };
    bus.emit("issue:completed", data);
    bus.emit("issue:completed", data);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("off removes handler", () => {
    const handler = vi.fn();
    bus.on("issue:failed", handler);
    bus.off("issue:failed", handler);
    bus.emit("issue:failed", {
      issueId: "i1",
      identifier: "PRJ-1",
      error: "boom",
      attempt: 0,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("multiple handlers for same event", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on("config:reloaded", h1);
    bus.on("config:reloaded", h2);
    bus.emit("config:reloaded", { timestamp: 999 });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("removeAllListeners clears everything", () => {
    const handler = vi.fn();
    bus.on("issue:dispatched", handler);
    bus.on("issue:failed", handler);
    bus.removeAllListeners();
    bus.emit("issue:dispatched", {
      issueId: "i1",
      identifier: "PRJ-1",
      attempt: 0,
    });
    bus.emit("issue:failed", {
      issueId: "i1",
      identifier: "PRJ-1",
      error: "x",
      attempt: 0,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("no error when emitting with no listeners", () => {
    expect(() => {
      bus.emit("shutdown:complete", {});
    }).not.toThrow();
  });

  it("handles complex event data correctly", () => {
    const handler = vi.fn();
    bus.on("tick:complete", handler);
    bus.emit("tick:complete", {
      timestamp: Date.now(),
      running: 3,
      retrying: 1,
      candidates: 10,
    });
    expect(handler).toHaveBeenCalledOnce();
    const data = handler.mock.calls[0][0];
    expect(data.running).toBe(3);
    expect(data.retrying).toBe(1);
    expect(data.candidates).toBe(10);
  });
});
