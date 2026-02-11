export type ToolDefinition = {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  handler: (args: unknown, ctx: ToolContext) => Promise<unknown>;
};

export type ToolContext = {
  projectId: string;
  runId: string;
  userId: string;
};

export type ToolRegistry = Map<string, ToolDefinition>;

export function createToolRegistry(tools: ToolDefinition[]): ToolRegistry {
  return new Map(tools.map((t) => [t.name, t]));
}

