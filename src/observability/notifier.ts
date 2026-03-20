import type { EventBus, OrchestraEventName } from "../events/event-bus.js";
import type { Logger } from "pino";
import { fetchWithTimeout } from "../util/fetch-timeout.js";

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

    const response = await fetchWithTimeout(
      this.config.webhookUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      10_000,
    );

    if (!response.ok) {
      this.logger.warn(
        { event, status: response.status },
        "Webhook returned non-OK status",
      );
    }
  }
}
