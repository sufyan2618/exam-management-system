import { env } from "../config/env";
import { logger } from "../lib/logger";
import { maskEmail } from "../lib/sanitize";
import { renderEmail, type EmailTemplate } from "../templates/email-templates";

/**
 * Sends via Brevo when configured; otherwise (local dev / no billing account) logs the
 * message to the console so flows stay testable without any paid service.
 */
export async function sendTemplatedEmail(to: string, tpl: EmailTemplate) {
  const { subject, html, text } = renderEmail(tpl);

  if (!env.BREVO_API_KEY || !env.EMAIL_FROM) {
    logger.info(`[email:console] to=${maskEmail(to)} subject="${subject}"`);
    if (!env.IS_PROD) console.log(`\n--- EMAIL (console transport) ---\nTo: ${to}\nSubject: ${subject}\n${text}\n---------------------------------\n`);
    return;
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": env.BREVO_API_KEY },
    body: JSON.stringify({ sender: { email: env.EMAIL_FROM }, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
  });
  if (!response.ok) {
    throw new Error(`Failed to send email (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
}
