import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authTokensSchema } from "@pagent/shared";
import { hashPassword, sha256, signAccessToken, verifyPassword } from "../auth.js";
import crypto from "node:crypto";
import { requireAuth } from "./middleware.js";
import { svgAvatar } from "../avatar.js";

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const refreshSchema = z.object({ refreshToken: z.string().min(10) });

const updateMeSchema = z.object({
  fullName: z.string().min(1).nullable().optional(),
  nationality: z.string().min(1).nullable().optional(),
  ethnicity: z.string().min(1).nullable().optional(),
  specialties: z.string().min(1).nullable().optional(),
  hobbies: z.string().min(1).nullable().optional(),
  gender: z.string().min(1).nullable().optional(),
  age: z.number().int().min(0).max(150).nullable().optional(),
  contact: z.string().min(1).nullable().optional(),
  contactWechat: z.string().min(1).nullable().optional(),
  contactPhone: z.string().min(1).nullable().optional(),
  contactEmail: z.string().min(1).nullable().optional(),
  workExperience: z.string().min(1).nullable().optional(),
  regenerateAvatar: z.boolean().optional()
});

export async function authRoutes(app: FastifyInstance) {
  app.get("/v1/auth/me", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const user = await app.ctx.prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return reply.code(404).send({ error: "not_found" });
    // Ensure avatar exists for UI
    if (!user.avatarSvg) {
      const next = await app.ctx.prisma.user.update({
        where: { id: user.id },
        data: { avatarSvg: svgAvatar(user.email) }
      });
      return {
        id: next.id,
        email: next.email,
        fullName: next.fullName,
        nationality: next.nationality,
        ethnicity: next.ethnicity,
        specialties: next.specialties,
        hobbies: next.hobbies,
        gender: next.gender,
        age: next.age,
        contact: next.contact,
        contactWechat: next.contactWechat,
        contactPhone: next.contactPhone,
        contactEmail: next.contactEmail,
        workExperience: next.workExperience,
        avatarSvg: next.avatarSvg
      };
    }
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      nationality: user.nationality,
      ethnicity: user.ethnicity,
      specialties: user.specialties,
      hobbies: user.hobbies,
      gender: user.gender,
      age: user.age,
      contact: user.contact,
      contactWechat: user.contactWechat,
      contactPhone: user.contactPhone,
      contactEmail: user.contactEmail,
      workExperience: user.workExperience,
      avatarSvg: user.avatarSvg
    };
  });

  app.put("/v1/auth/me", { preHandler: requireAuth(app) }, async (req: any, reply) => {
    const body = updateMeSchema.parse(req.body ?? {});
    const user = await app.ctx.prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return reply.code(404).send({ error: "not_found" });

    const updated = await app.ctx.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.nationality !== undefined ? { nationality: body.nationality } : {}),
        ...(body.ethnicity !== undefined ? { ethnicity: body.ethnicity } : {}),
        ...(body.specialties !== undefined ? { specialties: body.specialties } : {}),
        ...(body.hobbies !== undefined ? { hobbies: body.hobbies } : {}),
        ...(body.gender !== undefined ? { gender: body.gender } : {}),
        ...(body.age !== undefined ? { age: body.age } : {}),
        ...(body.contact !== undefined ? { contact: body.contact } : {}),
        ...(body.contactWechat !== undefined ? { contactWechat: body.contactWechat } : {}),
        ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone } : {}),
        ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail } : {}),
        ...(body.workExperience !== undefined ? { workExperience: body.workExperience } : {}),
        ...(body.regenerateAvatar ? { avatarSvg: svgAvatar(`${user.email}:${Date.now()}`) } : {})
      }
    });

    return {
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      nationality: updated.nationality,
      ethnicity: updated.ethnicity,
      specialties: updated.specialties,
      hobbies: updated.hobbies,
      gender: updated.gender,
      age: updated.age,
      contact: updated.contact,
      contactWechat: updated.contactWechat,
      contactPhone: updated.contactPhone,
      contactEmail: updated.contactEmail,
      workExperience: updated.workExperience,
      avatarSvg: updated.avatarSvg
    };
  });

  app.post("/v1/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const existing = await app.ctx.prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ error: "email_taken" });

    const user = await app.ctx.prisma.user.create({
      data: { email: body.email, passwordHash: await hashPassword(body.password), avatarSvg: svgAvatar(body.email) }
    });

    const accessToken = signAccessToken(app, user.id);
    const refreshToken = `${user.id}.${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await app.ctx.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt }
    });

    return reply.send(authTokensSchema.parse({ accessToken, refreshToken }));
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await app.ctx.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.code(401).send({ error: "invalid_credentials" });
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });

    const accessToken = signAccessToken(app, user.id);
    const refreshToken = `${user.id}.${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await app.ctx.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt }
    });

    return reply.send(authTokensSchema.parse({ accessToken, refreshToken }));
  });

  app.post("/v1/auth/refresh", async (req, reply) => {
    const body = refreshSchema.parse(req.body);
    const [userId] = body.refreshToken.split(".", 1);
    if (!userId) return reply.code(401).send({ error: "invalid_refresh" });

    const tokenHash = sha256(body.refreshToken);
    const token = await app.ctx.prisma.refreshToken.findFirst({
      where: { userId, tokenHash, revokedAt: null, expiresAt: { gt: new Date() } }
    });
    if (!token) return reply.code(401).send({ error: "invalid_refresh" });

    // rotate
    await app.ctx.prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    const newRefreshToken = `${userId}.${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await app.ctx.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(newRefreshToken), expiresAt }
    });

    const accessToken = signAccessToken(app, userId);
    return reply.send(authTokensSchema.parse({ accessToken, refreshToken: newRefreshToken }));
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    if (body.refreshToken) {
      const [userId] = body.refreshToken.split(".", 1);
      if (userId) {
        await app.ctx.prisma.refreshToken.updateMany({
          where: { userId, tokenHash: sha256(body.refreshToken), revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }
    }
    return reply.send({ ok: true });
  });
}
