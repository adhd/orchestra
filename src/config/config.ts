import os from "node:os";
import { WorkflowConfig } from "./schema.js";

/**
 * Resolve $VAR references and ~/... tilde paths in config string values.
 * Only resolves top-level string values that start with "$".
 * Tilde expansion runs after env var resolution so $VAR values also get expanded.
 */
export function resolveEnvVars<T>(obj: T): T {
  if (typeof obj === "string") {
    let result: string = obj;

    // $VAR resolution
    if (result.startsWith("$")) {
      const varName = result.slice(1);
      const value = process.env[varName];
      if (!value) {
        throw new Error(
          `Environment variable ${varName} referenced in config is not set`,
        );
      }
      result = value;
    }

    // Tilde expansion (after env var resolution so resolved values also expand)
    if (result.startsWith("~/")) {
      result = os.homedir() + result.slice(1);
    }

    return result as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item)) as unknown as T;
  }

  if (obj !== null && typeof obj === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveEnvVars(value);
    }
    return resolved as T;
  }

  return obj;
}

/**
 * Resolved config with all $VAR references replaced.
 */
export type ResolvedConfig = WorkflowConfig;

export function createResolvedConfig(raw: WorkflowConfig): ResolvedConfig {
  return resolveEnvVars(raw);
}
