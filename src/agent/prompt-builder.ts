import { Liquid } from "liquidjs";
import type { NormalizedIssue } from "../types/index.js";
import fs from "node:fs";
import path from "node:path";

const engine = new Liquid({
  strictVariables: false, // Allow missing vars in optional prompt layers
  strictFilters: true,
});

export interface PromptContext {
  issue: NormalizedIssue;
  attempt: number | null;
  promptsDir?: string; // directory containing global.md, {state}.md files
}

/**
 * Build the full prompt from up to three layers:
 * 1. Global prompt (prompts/global.md)
 * 2. Stage prompt (prompts/{state_lowercased}.md)
 * 3. Workflow template (from WORKFLOW.md body)
 * 4. Lifecycle context (auto-injected)
 */
export async function buildFullPrompt(
  workflowTemplate: string,
  ctx: PromptContext,
): Promise<string> {
  const parts: string[] = [];
  const vars = { issue: ctx.issue, attempt: ctx.attempt };

  // Layer 1: Global prompt
  if (ctx.promptsDir) {
    const globalPath = path.join(ctx.promptsDir, "global.md");
    try {
      const raw = fs.readFileSync(globalPath, "utf-8");
      const rendered = await engine.parseAndRender(raw, vars);
      parts.push(rendered.trim());
    } catch {
      // File doesn't exist or can't be read -- skip this layer
    }
  }

  // Layer 2: Stage-specific prompt
  if (ctx.promptsDir) {
    const stateName = ctx.issue.state.toLowerCase().replace(/\s+/g, "-");
    const stagePath = path.join(ctx.promptsDir, `${stateName}.md`);
    try {
      const raw = fs.readFileSync(stagePath, "utf-8");
      const rendered = await engine.parseAndRender(raw, vars);
      parts.push(rendered.trim());
    } catch {
      // File doesn't exist or can't be read -- skip this layer
    }
  }

  // Layer 3: Workflow template (from WORKFLOW.md body)
  if (workflowTemplate) {
    const rendered = await engine.parseAndRender(workflowTemplate, vars);
    parts.push(rendered.trim());
  }

  // Layer 4: Lifecycle context (always appended)
  parts.push(buildLifecycleContext(ctx));

  return parts.filter(Boolean).join("\n\n---\n\n");
}

/**
 * Build lifecycle context that's auto-injected into every prompt.
 */
function buildLifecycleContext(ctx: PromptContext): string {
  const { issue, attempt } = ctx;
  const lines: string[] = [
    "## Issue Context",
    `- **Issue**: ${issue.identifier}`,
    `- **Title**: ${issue.title}`,
    `- **State**: ${issue.state}`,
    `- **Priority**: ${issue.priority ?? "unset"}`,
  ];

  if (issue.url) lines.push(`- **URL**: ${issue.url}`);
  if (issue.labels.length > 0)
    lines.push(`- **Labels**: ${issue.labels.join(", ")}`);
  if (issue.branch_name) lines.push(`- **Branch**: ${issue.branch_name}`);

  if (attempt === null) {
    lines.push("", "This is the **first attempt** at this issue.");
  } else {
    lines.push(
      "",
      `This is **attempt ${attempt}**. Review your previous work and continue where you left off.`,
    );
  }

  return lines.join("\n");
}

/**
 * Build a continuation prompt for subsequent turns.
 * Keeps it minimal since the agent already has context from the prior session.
 */
export function buildContinuationPrompt(
  issue: NormalizedIssue,
  attempt: number,
): string {
  return [
    `Continue working on ${issue.identifier}: ${issue.title}`,
    `This is continuation attempt ${attempt}.`,
    `Pick up where you left off. Review your progress so far and continue.`,
  ].join("\n");
}
