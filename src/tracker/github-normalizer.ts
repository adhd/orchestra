import type { NormalizedIssue } from "../types/index.js";

/**
 * Raw shape returned by `gh issue list --json ...` and `gh issue view --json ...`.
 */
export interface GitHubRawIssue {
  id: string;
  number: number;
  title: string;
  body: string | null;
  labels: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  url: string;
  assignees: Array<{ login: string }>;
}

/**
 * Extract a numeric priority from GitHub labels.
 *
 * Recognized patterns (case-insensitive):
 *   - "p0", "p1", "p2", "p3"
 *   - "critical" (0), "high" (1), "medium" (2), "low" (3)
 *   - "priority:N", "priority-N", "priority N"
 */
export function extractPriority(labels: string[]): number | null {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (lower === "p0" || lower === "critical") return 0;
    if (lower === "p1" || lower === "high") return 1;
    if (lower === "p2" || lower === "medium") return 2;
    if (lower === "p3" || lower === "low") return 3;
    const match = lower.match(/^priority[:\s-]*(\d)$/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Normalize a raw GitHub issue into our domain model.
 */
export function normalizeGitHubIssue(
  raw: GitHubRawIssue,
  owner: string,
  repo: string,
  currentLabel: string,
): NormalizedIssue {
  const labelNames = raw.labels.map((l) => l.name);

  return {
    id: String(raw.number),
    identifier: `${owner}/${repo}#${raw.number}`,
    title: raw.title,
    description: raw.body ?? null,
    priority: extractPriority(labelNames),
    state: currentLabel,
    labels: labelNames,
    blocked_by: [], // GitHub Issues has no native blocking relation
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
    branch_name: null,
    url: raw.url,
  };
}
