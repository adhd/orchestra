import type { NormalizedIssue } from "../types/index.js";
import { extractPriority } from "./priority.js";

export { extractPriority };

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
