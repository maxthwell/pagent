import type { LlmProvider, ChatMessage, ToolDefinition, ToolCall } from "@pagent/providers";
import type { RunEvent } from "@pagent/shared";

export type AgentConfig = {
  systemPrompt: string;
  model: string;
  tools?: ToolDefinition[];
};

export type RunInput = {
  userMessage: string;
  priorMessages?: ChatMessage[];
};

export type RuntimeContext = {
  projectId: string;
  runId: string;
  userId: string;
};

export type RuntimeDeps = {
  llm: LlmProvider;
  now?: () => Date;
  toolRunner?: (call: { toolName: string; toolCallId: string; argumentsJson: string }) => Promise<string>;
  maxToolRounds?: number;
};

export async function* runAgent(
  deps: RuntimeDeps,
  ctx: RuntimeContext,
  agent: AgentConfig,
  input: RunInput
): AsyncIterable<RunEvent> {
  let seq = 0;
  const now = deps.now ?? (() => new Date());
  const emit = (type: RunEvent["type"], payload: RunEvent["payload"]) =>
    ({
      runId: ctx.runId,
      seq: ++seq,
      type,
      createdAt: now().toISOString(),
      payload
    }) as RunEvent;

  yield emit("run_started", { model: agent.model });

  const messages: ChatMessage[] = [
    { role: "system", content: agent.systemPrompt },
    ...(input.priorMessages ?? []),
    { role: "user", content: input.userMessage }
  ];

  const maxRounds = Math.max(0, deps.maxToolRounds ?? 3);
  let lastUsage: { inputTokens?: number; outputTokens?: number } | null = null;

  for (let round = 0; round <= maxRounds; round++) {
    let roundText = "";
    const toolCalls: ToolCall[] = [];

    for await (const e of deps.llm.streamChat({ model: agent.model, messages, tools: agent.tools })) {
      if (e.type === "text_delta") {
        roundText += e.delta;
        yield emit("assistant_delta", { delta: e.delta });
      } else if (e.type === "usage") {
        lastUsage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens };
        yield emit("usage", { ...lastUsage });
      } else if (e.type === "tool_call") {
        toolCalls.push({ id: e.toolCallId, name: e.toolName, argumentsJson: e.argumentsJson });
        yield emit("tool_call", { toolCallId: e.toolCallId, toolName: e.toolName, argumentsJson: e.argumentsJson });
      } else if (e.type === "error") {
        yield emit("error", { message: e.message, raw: e.raw ?? null });
        yield emit("run_finished", { ok: false, usage: lastUsage });
        return;
      }
    }

    if (toolCalls.length === 0) {
      yield emit("assistant_message", { content: roundText });
      yield emit("run_finished", { ok: true, usage: lastUsage });
      return;
    }

    // If tools were requested but we can't run them, stop here with the partial assistant text.
    if (!deps.toolRunner) {
      yield emit("assistant_message", { content: roundText });
      yield emit("run_finished", { ok: true, usage: lastUsage, toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name })) });
      return;
    }

    // Add assistant tool-call message, then tool results, then continue another round.
    messages.push({ role: "assistant", content: roundText, toolCalls });
    for (const c of toolCalls) {
      const out = await deps.toolRunner({ toolName: c.name, toolCallId: c.id, argumentsJson: c.argumentsJson });
      yield emit("tool_result", { toolCallId: c.id, toolName: c.name, content: out });
      messages.push({ role: "tool", toolName: c.name, toolCallId: c.id, content: out });
    }
  }

  // Max tool rounds exceeded; return whatever we have.
  yield emit("assistant_message", { content: "" });
  yield emit("run_finished", { ok: true, usage: lastUsage, note: "max_tool_rounds_exceeded" });
}
