import type { LlmEvent, LlmProvider, StreamChatParams } from "./llm.js";

export class MockProvider implements LlmProvider {
  async *streamChat(_params: StreamChatParams): AsyncIterable<LlmEvent> {
    const text = "Mock response from pagent. Configure a ProviderAccount to use real models.";
    for (const ch of text) {
      await new Promise((r) => setTimeout(r, 5));
      yield { type: "text_delta", delta: ch };
    }
    yield { type: "message", content: text };
    yield { type: "done" };
  }
}
