import type { ChatMessage, LlmEvent, LlmProvider, StreamChatParams, ToolCall } from "./llm.js";

type OpenAICompatConfig = {
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey: string;
};

function toOpenAIMessage(m: ChatMessage) {
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.argumentsJson } }))
    };
  }
  return { role: m.role, content: m.content };
}

export class OpenAICompatProvider implements LlmProvider {
  constructor(private readonly cfg: OpenAICompatConfig) {}

  async *streamChat(params: StreamChatParams): AsyncIterable<LlmEvent> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const tools = params.tools?.length
      ? params.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.jsonSchema } }))
      : undefined;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages.map(toOpenAIMessage),
        tools,
        tool_choice: tools ? "auto" : undefined,
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
    const toolCallsByIndex = new Map<number, ToolCall>();

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

            const toolCalls = json?.choices?.[0]?.delta?.tool_calls;
            if (Array.isArray(toolCalls)) {
              for (const tc of toolCalls) {
                const idx = typeof tc?.index === "number" ? tc.index : 0;
                const prev = toolCallsByIndex.get(idx) ?? { id: "", name: "", argumentsJson: "" };
                const nextId = typeof tc?.id === "string" ? tc.id : prev.id;
                const fn = tc?.function;
                const nextName = typeof fn?.name === "string" ? fn.name : prev.name;
                const argDelta = typeof fn?.arguments === "string" ? fn.arguments : "";
                toolCallsByIndex.set(idx, { id: nextId, name: nextName, argumentsJson: prev.argumentsJson + argDelta });
              }
            }

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

    if (toolCallsByIndex.size > 0) {
      const list = Array.from(toolCallsByIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v)
        .filter((c) => c.id && c.name);
      for (const c of list) {
        yield { type: "tool_call", toolCallId: c.id, toolName: c.name, argumentsJson: c.argumentsJson };
      }
    }

    yield { type: "done" };
  }
}
