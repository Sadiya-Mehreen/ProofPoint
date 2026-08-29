import { Resend } from "resend";
import { logger } from "./logger";

// RESEND_API_KEY is optional so local dev and early deploys keep working
// without an email provider configured -- the reset link just gets logged
// instead of emailed. Set RESEND_API_KEY (and optionally RESEND_FROM) in
// production so candidates actually receive it.
const apiKey = process.env["RESEND_API_KEY"];
const resend = apiKey ? new Resend(apiKey) : null;
const fromAddress = process.env["RESEND_FROM"] || "AuraCheck <onboarding@resend.dev>";

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (!resend) {
    logger.warn({ to, resetUrl }, "RESEND_API_KEY not set -- logging password reset link instead of emailing it");
    return;
  }

  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: "Reset your AuraCheck password",
    html: `
      <p>Someone requested a password reset for this AuraCheck account.</p>
      <p><a href="${resetUrl}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
      <p>If this wasn't you, you can safely ignore this email.</p>
    `,
  });

  if (error) {
    logger.error({ to, error }, "Failed to send password reset email via Resend");
    throw new Error("email_send_failed");
  }
}
