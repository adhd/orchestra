import type { TrackerClient, NormalizedIssue } from "../types/index.js";
import type { TrackerConfig } from "../config/schema.js";
import {
  normalizeLinearIssue,
  type LinearRawIssue,
} from "./linear-normalizer.js";

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  state { name }
  labels { nodes { name } }
  relations {
    nodes {
      type
      relatedIssue {
        identifier
        state { name }
      }
    }
  }
  createdAt
  updatedAt
  branchName
  url
`;

export class LinearClient implements TrackerClient {
  private endpoint: string;
  private apiKey: string;
  private projectSlug: string | undefined;
  private timeoutMs = 30_000;
  private pageSize = 50;

  constructor(config: TrackerConfig) {
    if (!config.api_key) {
      throw new Error("Linear tracker requires 'api_key' in config");
    }
    this.endpoint = config.endpoint;
    this.apiKey = config.api_key;
    this.projectSlug = config.project_slug;
  }

  async fetchCandidateIssues(
    activeStates: string[],
  ): Promise<NormalizedIssue[]> {
    const query = `
      query($activeStates: [String!]!, $projectSlug: String) {
        issues(
          first: ${this.pageSize}
          filter: {
            state: { name: { in: $activeStates } }
            ${this.projectSlug ? "project: { slugId: { eq: $projectSlug } }" : ""}
          }
        ) {
          nodes {
            ${ISSUE_FIELDS}
          }
        }
      }
    `;

    const variables: Record<string, unknown> = {
      activeStates,
      ...(this.projectSlug ? { projectSlug: this.projectSlug } : {}),
    };

    const data = await this.graphql<{
      issues: { nodes: LinearRawIssue[] };
    }>(query, variables);

    return data.issues.nodes.map(normalizeLinearIssue);
  }

  async fetchIssueStatesByIds(
    issueIds: string[],
  ): Promise<Map<string, string>> {
    const query = `
      query($ids: [String!]!) {
        issues(filter: { id: { in: $ids } }) {
          nodes {
            id
            state { name }
          }
        }
      }
    `;

    const data = await this.graphql<{
      issues: { nodes: Array<{ id: string; state: { name: string } }> };
    }>(query, { ids: issueIds });

    const result = new Map<string, string>();
    for (const node of data.issues.nodes) {
      result.set(node.id, node.state.name);
    }
    return result;
  }

  private async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Linear API error: ${response.status} ${response.statusText}`,
        );
      }

      const json = (await response.json()) as {
        data?: T;
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) {
        throw new Error(
          `Linear GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`,
        );
      }

      if (!json.data) {
        throw new Error("Linear API returned no data");
      }

      return json.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}
