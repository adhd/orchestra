import { describe, it, expect } from "vitest";
import {
  sanitizeIdentifier,
  buildWorkspacePath,
} from "../../src/workspace/path-safety.js";
import path from "node:path";

describe("sanitizeIdentifier", () => {
  it("keeps alphanumeric, dots, hyphens, underscores", () => {
    expect(sanitizeIdentifier("PROJ-123")).toBe("PROJ-123");
    expect(sanitizeIdentifier("my_project.v2")).toBe("my_project.v2");
  });

  it("replaces special characters with underscores", () => {
    expect(sanitizeIdentifier("PROJ/123")).toBe("PROJ_123");
    expect(sanitizeIdentifier("test@#$%")).toBe("test____");
    expect(sanitizeIdentifier("a b c")).toBe("a_b_c");
  });

  it("handles empty string", () => {
    expect(sanitizeIdentifier("")).toBe("");
  });
});

describe("buildWorkspacePath", () => {
  it("builds path under root", () => {
    const result = buildWorkspacePath("/tmp/workspaces", "PROJ-1");
    expect(result).toBe(path.resolve("/tmp/workspaces", "PROJ-1"));
  });

  it("rejects identifiers with slashes", () => {
    expect(() => buildWorkspacePath("/tmp/workspaces", "PROJ/1")).toThrow(
      "Unsafe identifier rejected",
    );
  });

  it("rejects identifiers with path traversal", () => {
    expect(() => buildWorkspacePath("/tmp/workspaces", "../../etc")).toThrow(
      "Unsafe identifier rejected",
    );
  });

  it("rejects identifiers with backslashes", () => {
    expect(() => buildWorkspacePath("/tmp/workspaces", "PROJ\\1")).toThrow(
      "Unsafe identifier rejected",
    );
  });
});
