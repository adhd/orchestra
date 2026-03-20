/**
 * Extract a numeric priority from issue labels.
 *
 * Recognized patterns (case-insensitive):
 *   - "p0", "p1", "p2", "p3"
 *   - "critical" (0), "high" (1), "medium" (2), "low" (3)
 *   - "priority:N", "priority-N", "priority N"
 *   - GitLab scoped labels: "priority::1", "priority::2", etc.
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
