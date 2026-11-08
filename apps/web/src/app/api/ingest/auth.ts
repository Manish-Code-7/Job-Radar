import { timingSafeEqual } from "node:crypto";
export function ingestAuthorized(req: Request): boolean {
  const token = process.env.INGEST_TOKEN ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token.length < 24 || got.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(token));
}
