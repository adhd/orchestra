import type { IssueOrcState, StateEvent } from "../types/index.js";

/**
 * Valid state transitions per the Symphony SPEC 6.1.
 * Pure function — no side effects.
 */
const TRANSITIONS: Record<
  IssueOrcState,
  Partial<Record<StateEvent["type"], IssueOrcState>>
> = {
  unclaimed: {
    dispatch: "claimed",
  },
  claimed: {
    worker_started: "running",
  },
  running: {
    schedule_retry: "retry_queued",
    reconcile_terminal: "released",
  },
  retry_queued: {
    retry_fired: "claimed",
    reconcile_terminal: "released",
  },
  released: {
    // terminal — no transitions out
  },
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: IssueOrcState,
    public readonly event: StateEvent["type"],
  ) {
    super(`Invalid transition: ${from} + ${event}`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * Compute the next state given current state and event.
 * Throws InvalidTransitionError if the transition is not allowed.
 */
export function transition(
  current: IssueOrcState,
  event: StateEvent,
): IssueOrcState {
  const next = TRANSITIONS[current]?.[event.type];
  if (!next) {
    throw new InvalidTransitionError(current, event.type);
  }
  return next;
}

/**
 * Check if an event is valid from the given state (without throwing).
 */
export function canTransition(
  current: IssueOrcState,
  eventType: StateEvent["type"],
): boolean {
  return TRANSITIONS[current]?.[eventType] !== undefined;
}
