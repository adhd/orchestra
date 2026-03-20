// Stub module for @anthropic-ai/claude-code
// The real package has no resolvable entry point, so Vite needs this alias.
export function query() {
  throw new Error("query() not mocked - use vi.mock in your test");
}

export type SDKMessage = {
  type: string;
  [key: string]: unknown;
};
