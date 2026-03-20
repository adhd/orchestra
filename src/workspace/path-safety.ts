import path from "node:path";

/**
 * Sanitize an issue identifier for use as a directory name.
 * Replaces non-alphanumeric characters (except '.', '-', '_') with underscores.
 */
export function sanitizeIdentifier(identifier: string): string {
  return identifier.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Build a workspace path for an issue, ensuring it's under the root.
 */
export function buildWorkspacePath(root: string, identifier: string): string {
  // Defense in depth: reject raw identifiers containing path traversal patterns
  if (
    identifier.includes("..") ||
    identifier.includes("/") ||
    identifier.includes("\\")
  ) {
    throw new Error(
      `Unsafe identifier rejected: "${identifier}" contains path traversal characters`,
    );
  }

  const sanitized = sanitizeIdentifier(identifier);
  const resolved = path.resolve(root, sanitized);

  // Belt-and-suspenders: verify resolved path is within root
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error(
      `Path traversal detected: ${identifier} resolved to ${resolved} which is outside ${root}`,
    );
  }

  return resolved;
}
