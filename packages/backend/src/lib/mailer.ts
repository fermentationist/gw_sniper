import nodemailer, { type Transporter } from "nodemailer";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { appConfig, type AppConfigRow } from "../db/schema.js";
import { decryptSecret } from "./crypto.js";

let cachedTransport: Transporter | null = null;
let cachedSignature: string | null = null;

function signatureOf(row: AppConfigRow): string {
  return [
    row.smtpHost ?? "",
    row.smtpPort ?? "",
    row.smtpUser ?? "",
    row.smtpPass ?? "",
  ].join("|");
}

export function invalidateMailer(): void {
  cachedTransport = null;
  cachedSignature = null;
}

async function loadConfig(): Promise<AppConfigRow | null> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1));
  return row ?? null;
}

async function getTransport(): Promise<
  { transport: Transporter; from: string; to: string } | null
> {
  const row = await loadConfig();
  if (
    !row ||
    !row.smtpHost ||
    !row.smtpPort ||
    !row.smtpUser ||
    !row.smtpPass ||
    !row.notificationEmail
  ) {
    return null;
  }
  const sig = signatureOf(row);
  if (!cachedTransport || cachedSignature !== sig) {
    const password = decryptSecret(row.smtpPass);
    cachedTransport = nodemailer.createTransport({
      host: row.smtpHost,
      port: row.smtpPort,
      secure: row.smtpPort === 465,
      auth: { user: row.smtpUser, pass: password },
    });
    cachedSignature = sig;
  }
  return {
    transport: cachedTransport,
    from: row.smtpUser,
    to: row.notificationEmail,
  };
}

export async function sendMail(params: {
  subject: string;
  html: string;
  text: string;
  /** Skip if globalEmailAlertsEnabled is false. */
  requiresGlobalFlag?: boolean;
}): Promise<{ sent: boolean; reason?: string }> {
  const row = await loadConfig();
  if (!row) return { sent: false, reason: "no_config" };
  if (params.requiresGlobalFlag && !row.globalEmailAlertsEnabled) {
    return { sent: false, reason: "global_alerts_disabled" };
  }
  const ctx = await getTransport();
  if (!ctx) return { sent: false, reason: "smtp_not_configured" };
  await ctx.transport.sendMail({
    from: ctx.from,
    to: ctx.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });
  return { sent: true };
}
