import { describe, it, expect } from "vitest";
import { ZodError, ZodIssueCode } from "zod";
import { formatError } from "../../src/config/error-formatter.js";

describe("formatError", () => {
  it("formats ZodError with path and message", () => {
    const zodError = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: "string",
        received: "number",
        path: ["tracker", "kind"],
        message: "Expected string, received number",
      },
    ]);

    const result = formatError(zodError);
    expect(result).toContain("Config error in WORKFLOW.md:");
    expect(result).toContain("tracker.kind: Expected string, received number");
  });

  it("formats ZodError with multiple issues", () => {
    const zodError = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: "number",
        received: "string",
        path: ["polling", "interval_ms"],
        message: "Expected number, received string",
      },
      {
        code: ZodIssueCode.invalid_type,
        expected: "string",
        received: "undefined",
        path: ["tracker", "api_key"],
        message: "Required",
      },
    ]);

    const result = formatError(zodError);
    expect(result).toContain(
      "polling.interval_ms: Expected number, received string",
    );
    expect(result).toContain("tracker.api_key: Required");
  });

  it("formats ENOENT errors with file path and init suggestion", () => {
    const err = new Error(
      "ENOENT: no such file or directory, open '/path/to/WORKFLOW.md'",
    );
    const result = formatError(err);
    expect(result).toContain("File not found: /path/to/WORKFLOW.md");
    expect(result).toContain("Create one with: orchestra init");
  });

  it("formats ENOENT errors when no quoted path is present", () => {
    const err = new Error("ENOENT: no such file or directory");
    const result = formatError(err);
    expect(result).toContain("File not found: unknown");
    expect(result).toContain("Create one with: orchestra init");
  });

  it("formats environment variable errors with export suggestion", () => {
    const err = new Error(
      "Environment variable LINEAR_API_KEY referenced in config is not set",
    );
    const result = formatError(err);
    expect(result).toContain("Environment variable LINEAR_API_KEY");
    expect(result).toContain("Set it with: export VAR=value or add it to .env");
  });

  it("returns message for generic Error instances", () => {
    const err = new Error("Something went wrong");
    const result = formatError(err);
    expect(result).toBe("Something went wrong");
  });

  it("converts non-Error values to string", () => {
    expect(formatError("plain string error")).toBe("plain string error");
    expect(formatError(42)).toBe("42");
    expect(formatError(null)).toBe("null");
    expect(formatError(undefined)).toBe("undefined");
  });

  it("formats ZodError with empty path as root-level error", () => {
    const zodError = new ZodError([
      {
        code: ZodIssueCode.invalid_type,
        expected: "object",
        received: "string",
        path: [],
        message: "Expected object, received string",
      },
    ]);

    const result = formatError(zodError);
    expect(result).toContain("Config error in WORKFLOW.md:");
    expect(result).toContain(": Expected object, received string");
  });
});
