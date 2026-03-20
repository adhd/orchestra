import type { NormalizedIssue } from "../types/index.js";
import { extractPriority } from "./priority.js";

export { extractPriority };

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
