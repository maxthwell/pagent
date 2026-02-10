import { z } from "zod";

export const providerTypeSchema = z.enum(["openai_compat", "anthropic", "gemini", "mock"]);
export type ProviderType = z.infer<typeof providerTypeSchema>;

export const runStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "canceled"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runEventTypeSchema = z.enum([
  "status",
  "run_started",
  "assistant_delta",
  "assistant_message",
  "usage",
  "tool_call",
  "tool_result",
  "error",
  "run_finished"
]);
export type RunEventType = z.infer<typeof runEventTypeSchema>;

export const runEventSchema = z.object({
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  type: runEventTypeSchema,
  createdAt: z.string().datetime().optional(),
  payload: z.record(z.any())
});
export type RunEvent = z.infer<typeof runEventSchema>;

export const sseEventName = "run_event" as const;

export function toSseChunk(event: RunEvent): string {
  const lines = [
    `id: ${event.seq}`,
    `event: ${sseEventName}`,
    `data: ${JSON.stringify(event)}`
  ];
  return `${lines.join("\n")}\n\n`;
}

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string()
});
export type AuthTokens = z.infer<typeof authTokensSchema>;
