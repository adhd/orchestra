import fs from "node:fs";
import matter from "gray-matter";
import { WorkflowConfigSchema, type WorkflowConfig } from "./schema.js";
import { createResolvedConfig, type ResolvedConfig } from "./config.js";

export interface LoadedWorkflow {
  config: ResolvedConfig;
  promptTemplate: string;
  rawConfig: WorkflowConfig;
}

/**
 * Parse a WORKFLOW.md file into validated config + prompt template.
 * YAML front matter provides config, markdown body is the prompt template.
 */
export function loadWorkflow(filePath: string): LoadedWorkflow {
  const raw = fs.readFileSync(filePath, "utf-8");
  return parseWorkflow(raw);
}

/**
 * Parse workflow content string (for testing without filesystem).
 */
export function parseWorkflow(content: string): LoadedWorkflow {
  const { data, content: body } = matter(content);

  const parsed = WorkflowConfigSchema.parse(data);
  const resolved = createResolvedConfig(parsed);

  return {
    config: resolved,
    promptTemplate: body.trim(),
    rawConfig: parsed,
  };
}
