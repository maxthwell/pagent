export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolDefinition = {
  name: string;
  description: string;
  jsonSchema: unknown;
};

export type ToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolName: string; toolCallId: string; content: string };

export type LlmTextDeltaEvent = { type: "text_delta"; delta: string };
export type LlmMessageEvent = { type: "message"; content: string };
export type LlmToolCallEvent = { type: "tool_call"; toolCallId: string; toolName: string; argumentsJson: string };
export type LlmUsageEvent = { type: "usage"; inputTokens?: number; outputTokens?: number };
export type LlmErrorEvent = { type: "error"; message: string; raw?: unknown };
export type LlmDoneEvent = { type: "done" };

export type LlmEvent =
  | LlmTextDeltaEvent
  | LlmMessageEvent
  | LlmToolCallEvent
  | LlmUsageEvent
  | LlmErrorEvent
  | LlmDoneEvent;

export type StreamChatParams = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  tools?: ToolDefinition[];
};

export interface LlmProvider {
  streamChat(params: StreamChatParams): AsyncIterable<LlmEvent>;
}
