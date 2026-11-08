/** Structured JSON logs (one line each) — easy to grep and to ship later. */
export function log(level: "info" | "warn" | "error", msg: string, meta: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  (level === "error" ? console.error : console.log)(line);
}
export const info = (m: string, meta?: Record<string, unknown>) => log("info", m, meta);
export const warn = (m: string, meta?: Record<string, unknown>) => log("warn", m, meta);
