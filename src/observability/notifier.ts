import type { EventBus, OrchestraEventName } from "../events/event-bus.js";
import type { Logger } from "pino";

export interface NotifierConfig {
  webhookUrl?: string;
  events: string[];
}

/**
 * Sends webhook notifications for configured events.
 * Fires HTTP POST with JSON body to the configured URL.
 */
export class Notifier {
  private logger: Logger;

  constructor(
    private config: NotifierConfig,
    private eventBus: EventBus,
    logger: Logger,
  ) {
    this.logger = logger.child({ component: "notifier" });
  }

  start(): void {
    if (!this.config.webhookUrl) return;

    for (const eventName of this.config.events) {
      this.eventBus.on(eventName as OrchestraEventName, (data: unknown) => {
        this.send(eventName, data).catch((err) => {
          this.logger.warn(
            { event: eventName, error: String(err) },
            "Webhook delivery failed",
          );
        });
      });
    }

    this.logger.info(
      { url: this.config.webhookUrl, events: this.config.events },
      "Notifier started",
    );
  }

  private async send(event: string, data: unknown): Promise<void> {
    if (!this.config.webhookUrl) return;

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          { event, status: response.status },
          "Webhook returned non-OK status",
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
