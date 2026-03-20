import type { NormalizedIssue } from "../types/index.js";

/**
 * Raw Linear GraphQL issue shape (subset of fields we query).
 */
export interface LinearRawIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority: number;
  state: { name: string };
  labels?: { nodes: Array<{ name: string }> };
  relations?: {
    nodes: Array<{
      type: string;
      relatedIssue: { identifier: string; state: { name: string } };
    }>;
  };
  createdAt: string;
  updatedAt: string;
  branchName?: string | null;
  url: string;
}

/**
 * Normalize a raw Linear issue into our domain model.
 */
export function normalizeLinearIssue(raw: LinearRawIssue): NormalizedIssue {
  const blockedBy = (raw.relations?.nodes ?? [])
    .filter((r) => r.type === "blocks")
    .map((r) => r.relatedIssue.identifier);

  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description ?? null,
    priority: raw.priority ?? null,
    state: raw.state.name,
    labels: (raw.labels?.nodes ?? []).map((l) => l.name),
    blocked_by: blockedBy,
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
    branch_name: raw.branchName ?? null,
    url: raw.url ?? null,
  };
}
