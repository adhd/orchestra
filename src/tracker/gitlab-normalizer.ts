import type { NormalizedIssue } from "../types/index.js";

/**
 * Raw shape returned by the GitLab REST API v4 for project issues.
 */
export interface GitLabRawIssue {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  labels: string[];
  state: string;
  created_at: string;
  updated_at: string;
  web_url: string;
}

/**
 * Extract a numeric priority from GitLab labels.
 *
 * Recognized patterns (case-insensitive):
 *   - "p0", "p1", "p2", "p3"
 *   - "critical" (0), "high" (1), "medium" (2), "low" (3)
 *   - GitLab scoped labels: "priority::1", "priority::2", etc.
 *   - "priority:N", "priority-N", "priority N"
 */
export function extractPriority(labels: string[]): number | null {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (lower === "p0" || lower === "critical") return 0;
    if (lower === "p1" || lower === "high") return 1;
    if (lower === "p2" || lower === "medium") return 2;
    if (lower === "p3" || lower === "low") return 3;
    // GitLab scoped labels: priority::1, priority::2, etc.
    const scopedMatch = lower.match(/^priority::(\d)$/);
    if (scopedMatch) return parseInt(scopedMatch[1], 10);
    // Fallback: priority:N, priority-N, priority N
    const colonMatch = lower.match(/^priority[:\s-]*(\d)$/);
    if (colonMatch) return parseInt(colonMatch[1], 10);
  }
  return null;
}

/**
 * Normalize a raw GitLab issue into our domain model.
 */
export function normalizeGitLabIssue(
  raw: GitLabRawIssue,
  projectPath: string,
  currentLabel: string,
): NormalizedIssue {
  return {
    id: String(raw.iid),
    identifier: `${projectPath}#${raw.iid}`,
    title: raw.title,
    description: raw.description ?? null,
    priority: extractPriority(raw.labels),
    state: currentLabel,
    labels: raw.labels,
    blocked_by: [],
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    branch_name: null,
    url: raw.web_url,
  };
}
