import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import { resolveEnvVars } from "../../src/config/config.js";

describe("Config edge cases", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set up test env vars
    process.env.TEST_PATH = "/custom/path";
    process.env.TEST_HOME = "~/projects";
    process.env.TEST_NESTED_REF = "nested-value";
    process.env.TEST_WITH_TILDE = "~/workspace/root";
    process.env.TEST_ITEM_A = "alpha";
    process.env.TEST_ITEM_B = "beta";
    process.env.TEST_EMPTY = "";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("tilde expansion: ~/foo becomes homedir + /foo", () => {
    const result = resolveEnvVars("~/foo");
    expect(result).toBe(os.homedir() + "/foo");
  });

  it("tilde expansion works with deeper paths", () => {
    const result = resolveEnvVars("~/a/b/c");
    expect(result).toBe(os.homedir() + "/a/b/c");
  });

  it("tilde only at start is expanded", () => {
    const result = resolveEnvVars("prefix~/foo");
    expect(result).toBe("prefix~/foo");
  });

  it("nested $VAR resolution in objects", () => {
    const result = resolveEnvVars({
      outer: {
        inner: "$TEST_NESTED_REF",
      },
    });
    expect(result).toEqual({
      outer: {
        inner: "nested-value",
      },
    });
  });

  it("$VAR that resolves to path with tilde gets expanded", () => {
    // TEST_WITH_TILDE = "~/workspace/root"
    const result = resolveEnvVars("$TEST_WITH_TILDE");
    expect(result).toBe(os.homedir() + "/workspace/root");
  });

  it("$VAR resolution then tilde expansion in nested object", () => {
    const result = resolveEnvVars({
      workspace: {
        root: "$TEST_WITH_TILDE",
      },
    });
    expect(result).toEqual({
      workspace: {
        root: os.homedir() + "/workspace/root",
      },
    });
  });

  it("array of $VARs", () => {
    const result = resolveEnvVars(["$TEST_ITEM_A", "$TEST_ITEM_B"]);
    expect(result).toEqual(["alpha", "beta"]);
  });

  it("mixed array of $VARs and literals", () => {
    const result = resolveEnvVars(["$TEST_ITEM_A", "literal", "$TEST_ITEM_B"]);
    expect(result).toEqual(["alpha", "literal", "beta"]);
  });

  it("array of $VARs in nested object", () => {
    const result = resolveEnvVars({
      items: ["$TEST_ITEM_A", "$TEST_ITEM_B"],
    });
    expect(result).toEqual({
      items: ["alpha", "beta"],
    });
  });

  it("number passthrough", () => {
    expect(resolveEnvVars(42)).toBe(42);
    expect(resolveEnvVars(0)).toBe(0);
    expect(resolveEnvVars(-1)).toBe(-1);
    expect(resolveEnvVars(3.14)).toBe(3.14);
  });

  it("boolean passthrough", () => {
    expect(resolveEnvVars(true)).toBe(true);
    expect(resolveEnvVars(false)).toBe(false);
  });

  it("null passthrough", () => {
    expect(resolveEnvVars(null)).toBeNull();
  });

  it("empty string $VAR reference throws", () => {
    // TEST_EMPTY is set but is empty string ""
    expect(() => resolveEnvVars("$TEST_EMPTY")).toThrow(
      "Environment variable TEST_EMPTY referenced in config is not set",
    );
  });

  it("undefined env var throws", () => {
    expect(() => resolveEnvVars("$TOTALLY_UNDEFINED_VAR_XYZ")).toThrow(
      "Environment variable TOTALLY_UNDEFINED_VAR_XYZ",
    );
  });

  it("deeply nested objects are resolved", () => {
    const result = resolveEnvVars({
      a: {
        b: {
          c: {
            d: "$TEST_PATH",
          },
        },
      },
    });
    expect(result.a.b.c.d).toBe("/custom/path");
  });

  it("object with mixed value types", () => {
    const result = resolveEnvVars({
      str: "$TEST_PATH",
      num: 42,
      bool: true,
      arr: ["$TEST_ITEM_A"],
      nested: { path: "~/local" },
    });
    expect(result).toEqual({
      str: "/custom/path",
      num: 42,
      bool: true,
      arr: ["alpha"],
      nested: { path: os.homedir() + "/local" },
    });
  });

  it("plain string without $ or ~ is unchanged", () => {
    expect(resolveEnvVars("just a string")).toBe("just a string");
    expect(resolveEnvVars("")).toBe("");
    expect(resolveEnvVars("no-vars-here")).toBe("no-vars-here");
  });

  it("string starting with $ but missing env var throws", () => {
    expect(() => resolveEnvVars("$MISSING_VAR_THAT_DOES_NOT_EXIST")).toThrow();
  });

  it("tilde not followed by slash is not expanded", () => {
    const result = resolveEnvVars("~notapath");
    expect(result).toBe("~notapath");
  });
});
