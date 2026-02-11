import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";

import { env } from "./env.js";
import { registerContext } from "./plugins.js";
import { registerJwt } from "./auth.js";
import { authRoutes } from "./routes/auth_routes.js";
import { projectRoutes } from "./routes/project_routes.js";
import { providerRoutes } from "./routes/provider_routes.js";
import { agentRoutes } from "./routes/agent_routes.js";
import { runRoutes } from "./routes/run_routes.js";
import { knowledgeRoutes } from "./routes/knowledge_routes.js";
import { skillsCatalogRoutes } from "./routes/skills_catalog_routes.js";
import { sessionRoutes } from "./routes/session_routes.js";
import { groupRoutes } from "./routes/group_routes.js";
import { toolRoutes } from "./routes/tool_routes.js";
import { emailRoutes } from "./routes/email_routes.js";
import { patchRoutes } from "./routes/patch_routes.js";
import { systemLogRoutes } from "./routes/system_log_routes.js";

const app = Fastify({ logger: true });

await registerContext(app);
registerJwt(app, env);

// Best-effort error capture into DB for Guardian analysis.
app.addHook("onError", async (req, _reply, error) => {
  try {
    const userId = (req as any).userId ? String((req as any).userId) : null;
    await (app as any).ctx?.prisma?.systemLog?.create?.({
      data: {
        userId,
        service: "api",
        level: "error",
        message: error?.message ? String(error.message) : String(error),
        stack: error?.stack ? String(error.stack) : null,
        metaJson: { method: req.method, url: req.url }
      }
    });
  } catch {
    // ignore
  }
});

await app.register(cors, {
  origin: env.WEB_ORIGIN,
  credentials: true
});

await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

await app.register(swagger, {
  openapi: {
    info: { title: "pagent API", version: "0.1.0" }
  }
});
await app.register(swaggerUi, { routePrefix: "/docs" });

app.get("/healthz", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(projectRoutes);
await app.register(providerRoutes);
await app.register(agentRoutes);
await app.register(groupRoutes);
await app.register(toolRoutes);
await app.register(emailRoutes);
await app.register(patchRoutes);
await app.register(systemLogRoutes);
await app.register(runRoutes);
await app.register(knowledgeRoutes);
await app.register(skillsCatalogRoutes);
await app.register(sessionRoutes);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
