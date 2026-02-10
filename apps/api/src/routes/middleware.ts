import type { FastifyInstance } from "fastify";

export function requireAuth(app: FastifyInstance) {
  return async (req: any, reply: any) => {
    const auth = req.headers.authorization;
    const accessToken =
      (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ") && auth.slice(7)) ||
      (typeof req.query?.accessToken === "string" ? req.query.accessToken : undefined);

    if (!accessToken) return reply.code(401).send({ error: "missing_token" });
    try {
      const payload = app.jwt.verify(accessToken) as any;
      req.userId = payload.sub as string;
    } catch {
      return reply.code(401).send({ error: "invalid_token" });
    }
  };
}

