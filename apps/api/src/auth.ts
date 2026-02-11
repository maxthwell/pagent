import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Env } from "./env.js";
import jwt from "@fastify/jwt";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function registerJwt(app: FastifyInstance, env: Env) {
  app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET
  });
}

export type AccessTokenPayload = { sub: string };

export function signAccessToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId } satisfies AccessTokenPayload, { expiresIn: "15m" });
}

export function signRefreshToken(refreshSecret: string, userId: string): string {
  // Not using app.jwt here because access/refresh have different secrets.
  // Minimal JWT implementation: use fastify-jwt "sign" by creating a temp signer.
  // But for simplicity: use crypto random + store hash; return opaque token.
  // (Still called "refreshToken" for API contract.)
  const opaque = `${userId}.${crypto.randomBytes(32).toString("hex")}`;
  return opaque;
}
