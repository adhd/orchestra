import { describe, it, expect } from "vitest";
import {
  transition,
  canTransition,
  InvalidTransitionError,
} from "../../src/orchestrator/state-machine.js";
import type { IssueOrcState, StateEvent } from "../../src/types/index.js";

describe("state-machine", () => {
  describe("transition", () => {
    it("unclaimed → claimed on dispatch", () => {
      expect(transition("unclaimed", { type: "dispatch" })).toBe("claimed");
    });

    it("claimed → running on worker_started", () => {
      expect(transition("claimed", { type: "worker_started" })).toBe("running");
    });

    it("running → retry_queued on schedule_retry", () => {
      expect(transition("running", { type: "schedule_retry" })).toBe(
        "retry_queued",
      );
    });

    it("running → released on reconcile_terminal", () => {
      expect(transition("running", { type: "reconcile_terminal" })).toBe(
        "released",
      );
    });

    it("retry_queued → claimed on retry_fired", () => {
      expect(transition("retry_queued", { type: "retry_fired" })).toBe(
        "claimed",
      );
    });

    it("retry_queued → released on reconcile_terminal", () => {
      expect(transition("retry_queued", { type: "reconcile_terminal" })).toBe(
        "released",
      );
    });
  });

  describe("invalid transitions", () => {
    const invalidCases: Array<[IssueOrcState, StateEvent["type"]]> = [
      ["unclaimed", "worker_started"],
      ["unclaimed", "schedule_retry"],
      ["unclaimed", "reconcile_terminal"],
      ["claimed", "dispatch"],
      ["claimed", "schedule_retry"],
      ["running", "dispatch"],
      ["running", "retry_fired"],
      ["released", "dispatch"],
      ["released", "worker_started"],
      ["released", "schedule_retry"],
      ["released", "retry_fired"],
      ["released", "reconcile_terminal"],
    ];

    it.each(invalidCases)("throws on %s + %s", (state, eventType) => {
      expect(() =>
        transition(state, { type: eventType } as StateEvent),
      ).toThrow(InvalidTransitionError);
    });
  });

  describe("canTransition", () => {
    it("returns true for valid transitions", () => {
      expect(canTransition("unclaimed", "dispatch")).toBe(true);
      expect(canTransition("running", "schedule_retry")).toBe(true);
    });

    it("returns false for invalid transitions", () => {
      expect(canTransition("unclaimed", "worker_started")).toBe(false);
      expect(canTransition("released", "dispatch")).toBe(false);
    });
  });
});
