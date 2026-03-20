import type { TrackerClient, NormalizedIssue } from "../types/index.js";

export class MemoryTracker implements TrackerClient {
  private issues = new Map<string, NormalizedIssue>();

  addIssue(issue: NormalizedIssue): void {
    this.issues.set(issue.id, { ...issue });
  }

  setState(issueId: string, state: string): void {
    const issue = this.issues.get(issueId);
    if (issue) {
      issue.state = state;
    }
  }

  getAllIssues(): NormalizedIssue[] {
    return Array.from(this.issues.values());
  }

  async fetchCandidateIssues(
    activeStates: string[],
  ): Promise<NormalizedIssue[]> {
    return Array.from(this.issues.values()).filter((issue) =>
      activeStates.includes(issue.state),
    );
  }

  async fetchIssueStatesByIds(
    issueIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const id of issueIds) {
      const issue = this.issues.get(id);
      if (issue) {
        result.set(id, issue.state);
      }
    }
    return result;
  }
}
