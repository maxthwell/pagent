import type { PrismaClient } from "@pagent/db";
import type { Env } from "./env.js";

export async function sendEmailViaOutbox(
  prisma: PrismaClient,
  env: Env,
  input: { userId: string; agentId?: string | null; to: string; subject: string; bodyMarkdown: string }
): Promise<{ ok: true; outboxId: string; sent: boolean } | { ok: false; error: string; message?: string; outboxId?: string }> {
  const created = await prisma.emailOutbox.create({
    data: {
      userId: input.userId,
      agentId: input.agentId ?? null,
      to: input.to,
      subject: input.subject,
      bodyMarkdown: input.bodyMarkdown,
      status: "stored"
    }
  });

  const smtpUrl = env.SMTP_URL;
  if (!smtpUrl) return { ok: true, outboxId: created.id, sent: false };

  const from = env.SMTP_FROM ?? input.to;
  try {
    let nm: any;
    try {
      const mod: any = await import("nodemailer");
      nm = mod?.default ?? mod;
    } catch {
      await prisma.emailOutbox.update({
        where: { id: created.id },
        data: { status: "failed", error: "nodemailer_missing" }
      });
      return { ok: false, error: "nodemailer_missing", outboxId: created.id, message: "Install nodemailer to enable SMTP sending." };
    }

    const transport = nm.createTransport(smtpUrl);
    await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.bodyMarkdown,
      html: markdownToBasicHtml(input.bodyMarkdown)
    });
    await prisma.emailOutbox.update({
      where: { id: created.id },
      data: { status: "sent", sentAt: new Date(), error: null }
    });
    return { ok: true, outboxId: created.id, sent: true };
  } catch (e: any) {
    await prisma.emailOutbox.update({
      where: { id: created.id },
      data: { status: "failed", error: e?.message ? String(e.message) : String(e) }
    });
    return { ok: false, error: "smtp_failed", outboxId: created.id, message: e?.message ? String(e.message) : String(e) };
  }
}

function markdownToBasicHtml(md: string): string {
  const escaped = String(md)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace">${escaped}</pre>`;
}
