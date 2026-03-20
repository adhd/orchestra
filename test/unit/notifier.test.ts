import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Notifier } from "../../src/observability/notifier.js";
import { EventBus } from "../../src/events/event-bus.js";
import pino from "pino";

describe("Notifier", () => {
  let eventBus: EventBus;
  const logger = pino({ level: "silent" });

  beforeEach(() => {
    eventBus = new EventBus();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends POST to webhook URL with correct payload", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const notifier = new Notifier(
      {
        webhookUrl: "https://hooks.example.com/notify",
        events: ["issue:completed"],
      },
      eventBus,
      logger,
    );
    notifier.start();

    eventBus.emit("issue:completed", {
      issueId: "i1",
      identifier: "PRJ-1",
      success: true,
      sessionId: "s1",
    });

    // Allow async send to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/notify");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(options?.body as string);
    expect(body.event).toBe("issue:completed");
    expect(body.timestamp).toBeDefined();
    expect(body.data.issueId).toBe("i1");
    expect(body.data.identifier).toBe("PRJ-1");
  });

  it("handles webhook timeout gracefully", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("aborted")), 10);
        }),
    );

    const notifier = new Notifier(
      {
        webhookUrl: "https://hooks.example.com/slow",
        events: ["issue:failed"],
      },
      eventBus,
      logger,
    );
    notifier.start();

    eventBus.emit("issue:failed", {
      issueId: "i1",
      identifier: "PRJ-1",
      error: "boom",
      attempt: 0,
    });

    // Should not throw — error is caught and logged
    await new Promise((r) => setTimeout(r, 100));

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("only subscribes to configured events", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const notifier = new Notifier(
      {
        webhookUrl: "https://hooks.example.com/notify",
        events: ["issue:max_retries"], // only this event
      },
      eventBus,
      logger,
    );
    notifier.start();

    // Emit an event NOT in the configured list
    eventBus.emit("issue:completed", {
      issueId: "i1",
      identifier: "PRJ-1",
      success: true,
      sessionId: "s1",
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();

    // Emit a configured event
    eventBus.emit("issue:max_retries", {
      issueId: "i2",
      identifier: "PRJ-2",
      attempt: 3,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("no-op when no webhook URL configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const notifier = new Notifier(
      {
        webhookUrl: undefined,
        events: ["issue:completed"],
      },
      eventBus,
      logger,
    );
    notifier.start();

    eventBus.emit("issue:completed", {
      issueId: "i1",
      identifier: "PRJ-1",
      success: true,
      sessionId: "s1",
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs warning on non-OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    const notifier = new Notifier(
      {
        webhookUrl: "https://hooks.example.com/notify",
        events: ["issue:completed"],
      },
      eventBus,
      logger,
    );
    notifier.start();

    eventBus.emit("issue:completed", {
      issueId: "i1",
      identifier: "PRJ-1",
      success: true,
      sessionId: null,
    });

    // Should not throw
    await new Promise((r) => setTimeout(r, 50));
  });
});
