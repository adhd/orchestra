import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TrackerClient, NormalizedIssue } from "../types/index.js";
import {
  normalizeGitHubIssue,
  type GitHubRawIssue,
} from "./github-normalizer.js";

const execFileAsync = promisify(execFile);

export interface GitHubTrackerConfig {
  owner: string;
  repo: string;
  active_labels?: string[];
  terminal_labels?: string[];
}

/**
 * GitHub Issues tracker using the `gh` CLI.
 *
 * Authentication is delegated entirely to `gh auth` -- no tokens
 * need to be configured in the orchestra workflow file.
 */
export class GitHubClient implements TrackerClient {
  private owner: string;
  private repo: string;
  private activeLabels: string[];
  private terminalLabels: string[];

  constructor(config: GitHubTrackerConfig) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.activeLabels = config.active_labels ?? ["todo", "in-progress"];
    this.terminalLabels = config.terminal_labels ?? ["done"];
  }

  async fetchCandidateIssues(
    activeStates: string[],
  ): Promise<NormalizedIssue[]> {
    const labels = activeStates.length > 0 ? activeStates : this.activeLabels;

    // Fetch issues for each active label, deduplicating by issue number.
    const allIssues: NormalizedIssue[] = [];
    const seenIds = new Set<string>();

    for (const label of labels) {
      try {
        const { stdout } = await execFileAsync(
          "gh",
          [
            "issue",
            "list",
            "--repo",
            `${this.owner}/${this.repo}`,
            "--label",
            label,
            "--state",
            "open",
            "--json",
            "id,number,title,body,labels,createdAt,updatedAt,url,assignees",
            "--limit",
            "50",
          ],
          { timeout: 30_000 },
        );

        const raw = JSON.parse(stdout) as GitHubRawIssue[];
        for (const issue of raw) {
          const id = String(issue.number);
          if (!seenIds.has(id)) {
            seenIds.add(id);
            allIssues.push(
              normalizeGitHubIssue(issue, this.owner, this.repo, label),
            );
          }
        }
      } catch {
        // Label may not exist or gh may be unavailable -- skip gracefully.
      }
    }

    return allIssues;
  }

  async fetchIssueStatesByIds(
    issueIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    const settled = await Promise.allSettled(
      issueIds.map((issueNumber) => this.fetchSingleIssueState(issueNumber)),
    );

    for (let i = 0; i < issueIds.length; i++) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled" && outcome.value !== undefined) {
        result.set(issueIds[i], outcome.value);
      }
    }

    return result;
  }

  private async fetchSingleIssueState(issueNumber: string): Promise<string> {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "issue",
        "view",
        issueNumber,
        "--repo",
        `${this.owner}/${this.repo}`,
        "--json",
        "state,labels",
      ],
      { timeout: 15_000 },
    );

    const data = JSON.parse(stdout) as {
      state: string;
      labels: Array<{ name: string }>;
    };

    if (data.state === "CLOSED") {
      return this.terminalLabels[0] ?? "Done";
    }

    const labelNames = data.labels.map((l) => l.name.toLowerCase());
    const terminalLabel = this.terminalLabels.find((l) =>
      labelNames.includes(l.toLowerCase()),
    );
    const activeLabel = this.activeLabels.find((l) =>
      labelNames.includes(l.toLowerCase()),
    );

    if (terminalLabel) return terminalLabel;
    if (activeLabel) return activeLabel;
    return "unknown";
  }
}
