import type { SDKMessage } from "@anthropic-ai/claude-code";

export interface ToolUseBlock {
  name: string;
  id?: string;
}

/**
 * Extract tool_use blocks from an SDK assistant message.
 * Returns empty array if the message doesn't contain tool uses.
 */
export function extractToolUses(msg: SDKMessage): ToolUseBlock[] {
  if (!("message" in msg) || !msg.message || typeof msg.message !== "object")
    return [];
  const message = msg.message as Record<string, unknown>;
  if (!("content" in message) || !Array.isArray(message.content)) return [];

  return (message.content as Array<Record<string, unknown>>)
    .filter(
      (block) => block.type === "tool_use" && typeof block.name === "string",
    )
    .map((block) => ({
      name: block.name as string,
      id: block.id as string | undefined,
    }));
}

export function isAssistantMessage(msg: SDKMessage): boolean {
  return msg.type === "assistant";
}
