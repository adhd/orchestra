import { ZodError } from "zod";

/**
 * Format errors into user-friendly CLI messages.
 * Handles Zod validation errors, ENOENT, env var references, and generic errors.
 */
export function formatError(err: unknown): string {
  if (err instanceof ZodError) {
    const lines = ["Config error in WORKFLOW.md:"];
    for (const issue of err.issues) {
      const path = issue.path.join(".");
      lines.push(`  ${path}: ${issue.message}`);
    }
    return lines.join("\n");
  }

  if (err instanceof Error) {
    if (err.message.includes("ENOENT")) {
      const match = err.message.match(/'([^']+)'/);
      const filePath = match?.[1] ?? "unknown";
      return `File not found: ${filePath}\nCreate one with: orchestra init`;
    }
    if (err.message.includes("Environment variable")) {
      return `${err.message}\nSet it with: export VAR=value or add it to .env`;
    }
    return err.message;
  }

  return String(err);
}
