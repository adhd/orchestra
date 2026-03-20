import type { TrackerClient, NormalizedIssue } from "../types/index.js";
import {
  normalizeGitLabIssue,
  type GitLabRawIssue,
} from "./gitlab-normalizer.js";

export interface GitLabTrackerConfig {
  endpoint?: string;
  token: string;
  project_path: string;
  active_labels?: string[];
  terminal_labels?: string[];
}

/**
 * GitLab Issues tracker using the REST API v4.
 *
 * Requires a personal access token with `read_api` scope (or broader).
 * The `project_path` should be URL-encoded-safe, e.g. "group/project".
 */
export class GitLabClient implements TrackerClient {
  private endpoint: string;
  private token: string;
  private projectPath: string;
  private activeLabels: string[];
  private terminalLabels: string[];
  private timeoutMs = 30_000;

  constructor(config: GitLabTrackerConfig) {
    this.endpoint = (config.endpoint ?? "https://gitlab.com").replace(
      /\/$/,
      "",
    );
    this.token = config.token;
    this.projectPath = config.project_path;
    this.activeLabels = config.active_labels ?? ["todo", "in-progress"];
    this.terminalLabels = config.terminal_labels ?? ["done"];
  }

  async fetchCandidateIssues(
    activeStates: string[],
  ): Promise<NormalizedIssue[]> {
    const labels = activeStates.length > 0 ? activeStates : this.activeLabels;
    const allIssues: NormalizedIssue[] = [];
    const seenIds = new Set<string>();

    for (const label of labels) {
      try {
        const encodedProject = encodeURIComponent(this.projectPath);
        const url = `${this.endpoint}/api/v4/projects/${encodedProject}/issues?labels=${encodeURIComponent(label)}&state=opened&per_page=50`;

        const response = await this.fetch(url);
        const raw = (await response.json()) as GitLabRawIssue[];

        for (const issue of raw) {
          const id = String(issue.iid);
          if (!seenIds.has(id)) {
            seenIds.add(id);
            allIssues.push(
              normalizeGitLabIssue(issue, this.projectPath, label),
            );
          }
        }
      } catch {
        // Label may not exist or API may be unavailable -- skip gracefully.
      }
    }

    return allIssues;
  }

  async fetchIssueStatesByIds(
    issueIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const encodedProject = encodeURIComponent(this.projectPath);

    for (const iid of issueIds) {
      try {
        const url = `${this.endpoint}/api/v4/projects/${encodedProject}/issues/${iid}`;
        const response = await this.fetch(url);
        const data = (await response.json()) as GitLabRawIssue;

        if (data.state === "closed") {
          result.set(iid, "Done");
        } else {
          const labelLower = data.labels.map((l) => l.toLowerCase());
          const terminal = this.terminalLabels.find((t) =>
            labelLower.includes(t.toLowerCase()),
          );
          const active = this.activeLabels.find((a) =>
            labelLower.includes(a.toLowerCase()),
          );
          result.set(iid, terminal ?? active ?? "unknown");
        }
      } catch {
        // Issue not found or API error -- skip.
      }
    }

    return result;
  }

  private async fetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        headers: { "PRIVATE-TOKEN": this.token },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
