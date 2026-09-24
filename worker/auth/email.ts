/**
 * Transactional email, in order of preference:
 * 1. Cloudflare Email Service — a `send_email` binding named EMAIL (needs a domain onboarded
 *    to Email Sending; see docs/architecture.md).
 * 2. Resend's HTTP API when RESEND_API_KEY is set (no SDK dependency).
 * 3. Local development only: written to the log and kept in `devOutbox`. Anywhere but
 *    localhost a missing provider is an error, so sign-in codes never end up in production logs.
 */

/** Minimal shape of the Email Service binding, which is optional in wrangler.jsonc. */
interface EmailBinding {
  send(message: { to: string; from: string; subject: string; text: string }): Promise<unknown>;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/** Last messages "sent" in local development and tests. */
export const devOutbox: OutgoingEmail[] = [];

function isLocal(baseURL: string): boolean {
  const { hostname } = new URL(baseURL);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Whether sign-in codes can actually be delivered from this deployment. */
export function canSendEmail(env: Env, baseURL: string): boolean {
  return Boolean((env as Env & { EMAIL?: EmailBinding }).EMAIL) || Boolean(env.RESEND_API_KEY) || isLocal(baseURL);
}

export async function sendEmail(env: Env, baseURL: string, email: OutgoingEmail): Promise<void> {
  const binding = (env as Env & { EMAIL?: EmailBinding }).EMAIL;
  if (binding) {
    await binding.send({ to: email.to, from: env.EMAIL_FROM, subject: email.subject, text: email.text });
    return;
  }
  if (!env.RESEND_API_KEY) {
    if (!isLocal(baseURL)) throw new Error("No email provider configured (EMAIL binding or RESEND_API_KEY)");
    devOutbox.push(email);
    if (devOutbox.length > 50) devOutbox.shift();
    console.log(`[dev email] to=${email.to} subject="${email.subject}"\n${email.text}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email.to], subject: email.subject, text: email.text }),
  });
  if (!response.ok) {
    throw new Error(`Email provider responded ${response.status}: ${await response.text()}`);
  }
}

export function signInCodeEmail(to: string, otp: string): OutgoingEmail {
  return {
    to,
    subject: `${otp} er innloggingskoden din til Slump`,
    text: `Innloggingskoden din er: ${otp}\n\nKoden er gyldig i 10 minutter. Har du ikke bedt om den, kan du se bort fra denne e-posten.`,
  };
}

export function inviteEmail(to: string, breweryName: string, inviterName: string, appUrl: string): OutgoingEmail {
  return {
    to,
    subject: `Du er invitert til ${breweryName}`,
    text:
      `${inviterName || "Noen"} har invitert deg til ${breweryName} i Slump.\n\n` +
      `Logg inn med denne e-postadressen på ${appUrl} for å bli med.`,
  };
}
