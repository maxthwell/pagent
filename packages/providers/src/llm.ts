export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "tool"; toolName: string; toolCallId: string; content: string };

export type LlmTextDeltaEvent = { type: "text_delta"; delta: string };
export type LlmMessageEvent = { type: "message"; content: string };
export type LlmUsageEvent = { type: "usage"; inputTokens?: number; outputTokens?: number };
export type LlmErrorEvent = { type: "error"; message: string; raw?: unknown };
export type LlmDoneEvent = { type: "done" };

export type LlmEvent = LlmTextDeltaEvent | LlmMessageEvent | LlmUsageEvent | LlmErrorEvent | LlmDoneEvent;

export type StreamChatParams = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
};

export interface LlmProvider {
  streamChat(params: StreamChatParams): AsyncIterable<LlmEvent>;
}

