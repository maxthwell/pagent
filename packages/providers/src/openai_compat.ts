import type { ChatMessage, LlmEvent, LlmProvider, StreamChatParams } from "./llm.js";

type OpenAICompatConfig = {
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey: string;
};

function toOpenAIMessage(m: ChatMessage) {
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
  }
  return { role: m.role, content: m.content };
}

export class OpenAICompatProvider implements LlmProvider {
  constructor(private readonly cfg: OpenAICompatConfig) {}

  async *streamChat(params: StreamChatParams): AsyncIterable<LlmEvent> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages.map(toOpenAIMessage),
        temperature: params.temperature ?? 0.2,
        stream: true,
        stream_options: { include_usage: true }
      })
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      yield { type: "error", message: `OpenAI-compatible request failed: ${res.status}`, raw: text };
      yield { type: "done" };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const idx = buffer.indexOf("\n\n");
        if (idx < 0) break;
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            yield { type: "done" };
            return;
          }
          try {
            const json = JSON.parse(data) as any;
            const delta = json?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length) yield { type: "text_delta", delta };
            const usage = json?.usage;
            if (usage && typeof usage === "object") {
              yield {
                type: "usage",
                inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
                outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined
              };
            }
          } catch (e) {
            yield { type: "error", message: "Failed to parse provider stream chunk", raw: { data, error: String(e) } };
          }
        }
      }
    }

    yield { type: "done" };
  }
}
