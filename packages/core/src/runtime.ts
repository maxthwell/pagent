import type { LlmProvider, ChatMessage } from "@pagent/providers";
import type { RunEvent } from "@pagent/shared";

export type AgentConfig = {
  systemPrompt: string;
  model: string;
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

  let fullText = "";
  let lastUsage: { inputTokens?: number; outputTokens?: number } | null = null;
  for await (const e of deps.llm.streamChat({ model: agent.model, messages })) {
    if (e.type === "text_delta") {
      fullText += e.delta;
      yield emit("assistant_delta", { delta: e.delta });
    } else if (e.type === "usage") {
      lastUsage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens };
      yield emit("usage", { ...lastUsage });
    } else if (e.type === "error") {
      yield emit("error", { message: e.message, raw: e.raw ?? null });
      break;
    }
  }

  yield emit("assistant_message", { content: fullText });
  yield emit("run_finished", { ok: true, usage: lastUsage });
}
