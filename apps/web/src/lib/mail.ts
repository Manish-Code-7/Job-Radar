import "server-only";
import nodemailer from "nodemailer";
import { env } from "./env";

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined })
  : null;

export async function sendMail(to: string, subject: string, text: string) {
  if (!transport) {
    // Dev without SMTP: print to the server log instead.
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
}
