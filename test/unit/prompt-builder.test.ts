import { describe, it, expect } from "vitest";
import {
  buildFullPrompt,
  buildContinuationPrompt,
} from "../../src/agent/prompt-builder.js";
import type { NormalizedIssue } from "../../src/types/index.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testIssue: NormalizedIssue = {
  id: "issue-1",
  identifier: "PROJ-42",
  title: "Fix the login bug",
  description: "Users cannot log in with SSO",
  priority: 1,
  state: "Todo",
  labels: ["bug", "auth"],
  blocked_by: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  branch_name: "proj-42-fix-login",
  url: "https://linear.app/proj/issue/PROJ-42",
};

describe("buildFullPrompt", () => {
  it("returns lifecycle context even with empty template", async () => {
    const result = await buildFullPrompt("", {
      issue: testIssue,
      attempt: null,
    });
    expect(result).toContain("## Issue Context");
    expect(result).toContain("PROJ-42");
    expect(result).toContain("first attempt");
  });

  it("includes workflow template separated by ---", async () => {
    const result = await buildFullPrompt("Do the work.", {
      issue: testIssue,
      attempt: null,
    });
    expect(result).toContain("Do the work.");
    expect(result).toContain("---");
    expect(result).toContain("## Issue Context");
  });

  it("includes priority as unset when null", async () => {
    const noPriorityIssue = { ...testIssue, priority: null };
    const result = await buildFullPrompt("", {
      issue: noPriorityIssue,
      attempt: null,
    });
    expect(result).toContain("**Priority**: unset");
  });

  it("includes branch name when present", async () => {
    const result = await buildFullPrompt("", {
      issue: testIssue,
      attempt: null,
    });
    expect(result).toContain("**Branch**: proj-42-fix-login");
  });

  it("includes labels when present", async () => {
    const result = await buildFullPrompt("", {
      issue: testIssue,
      attempt: null,
    });
    expect(result).toContain("**Labels**: bug, auth");
  });

  it("shows attempt number for retries", async () => {
    const result = await buildFullPrompt("", {
      issue: testIssue,
      attempt: 3,
    });
    expect(result).toContain("**attempt 3**");
    expect(result).not.toContain("first attempt");
  });

  it("omits URL line when url is null", async () => {
    const noUrlIssue = { ...testIssue, url: null };
    const result = await buildFullPrompt("", {
      issue: noUrlIssue,
      attempt: null,
    });
    expect(result).not.toContain("**URL**");
  });

  it("omits labels line when labels are empty", async () => {
    const noLabelsIssue = { ...testIssue, labels: [] };
    const result = await buildFullPrompt("", {
      issue: noLabelsIssue,
      attempt: null,
    });
    expect(result).not.toContain("**Labels**");
  });
});

describe("buildFullPrompt with prompt layers", () => {
  let tmpDir: string;

  function createPromptsDir(files: Record<string, string>): string {
    const promptsDir = path.join(tmpDir, "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(promptsDir, name), content);
    }
    return promptsDir;
  }

  // Create/clean temp dir for each test
  it("loads global.md as layer 1", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-test-"));
    const promptsDir = createPromptsDir({
      "global.md": "You are a helpful coding assistant.",
    });
    const result = await buildFullPrompt("Do the work.", {
      issue: testIssue,
      attempt: null,
      promptsDir,
    });
    expect(result).toContain("You are a helpful coding assistant.");
    expect(result).toContain("Do the work.");
    expect(result).toContain("## Issue Context");
    // Global should come before workflow template
    const globalIdx = result.indexOf("helpful coding assistant");
    const workflowIdx = result.indexOf("Do the work");
    expect(globalIdx).toBeLessThan(workflowIdx);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads stage-specific prompt matching issue state", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-test-"));
    const promptsDir = createPromptsDir({
      "todo.md": "Focus on planning before implementation.",
    });
    const result = await buildFullPrompt("Do the work.", {
      issue: testIssue, // state is "Todo"
      attempt: null,
      promptsDir,
    });
    expect(result).toContain("Focus on planning before implementation.");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles multi-word state names with hyphens", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-test-"));
    const promptsDir = createPromptsDir({
      "in-progress.md": "Keep working on the implementation.",
    });
    const inProgressIssue = { ...testIssue, state: "In Progress" };
    const result = await buildFullPrompt("Do the work.", {
      issue: inProgressIssue,
      attempt: null,
      promptsDir,
    });
    expect(result).toContain("Keep working on the implementation.");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renders liquid variables in prompt layer files", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-test-"));
    const promptsDir = createPromptsDir({
      "global.md": "Working on {{ issue.identifier }}.",
    });
    const result = await buildFullPrompt("", {
      issue: testIssue,
      attempt: null,
      promptsDir,
    });
    expect(result).toContain("Working on PROJ-42.");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips missing prompt files gracefully", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-test-"));
    const promptsDir = path.join(tmpDir, "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    // No files created - should not error
    const result = await buildFullPrompt("Do the work.", {
      issue: testIssue,
      attempt: null,
      promptsDir,
    });
    expect(result).toContain("Do the work.");
    expect(result).toContain("## Issue Context");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("assembles all layers in correct order", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-test-"));
    const promptsDir = createPromptsDir({
      "global.md": "GLOBAL_LAYER",
      "todo.md": "STAGE_LAYER",
    });
    const result = await buildFullPrompt("WORKFLOW_LAYER", {
      issue: testIssue,
      attempt: null,
      promptsDir,
    });
    const globalIdx = result.indexOf("GLOBAL_LAYER");
    const stageIdx = result.indexOf("STAGE_LAYER");
    const workflowIdx = result.indexOf("WORKFLOW_LAYER");
    const lifecycleIdx = result.indexOf("## Issue Context");
    expect(globalIdx).toBeLessThan(stageIdx);
    expect(stageIdx).toBeLessThan(workflowIdx);
    expect(workflowIdx).toBeLessThan(lifecycleIdx);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("buildContinuationPrompt", () => {
  it("includes issue identifier and title", () => {
    const result = buildContinuationPrompt(testIssue, 3);
    expect(result).toContain("PROJ-42");
    expect(result).toContain("Fix the login bug");
    expect(result).toContain("attempt 3");
  });
});
