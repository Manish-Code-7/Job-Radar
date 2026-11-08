import "server-only";
import { AwsClient } from "aws4fetch";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Resumes are encrypted (AES-256-GCM, key in RESUME_ENCRYPTION_KEY) before they leave this server,
 * then stored in Cloudflare R2. Layout of a stored object: [12-byte IV][16-byte tag][ciphertext].
 */
function key(): Buffer {
  const k = Buffer.from(process.env.RESUME_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("RESUME_ENCRYPTION_KEY must be 32 bytes, base64 (openssl rand -base64 32)");
  return k;
}

export function encrypt(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function decrypt(blob: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", key(), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

function r2() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) throw new Error("R2 is not configured");
  const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  const url = (k: string) => `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${k.split("/").map(encodeURIComponent).join("/")}`;
  return { client, url };
}

export async function putResume(objectKey: string, pdf: Buffer): Promise<void> {
  const { client, url } = r2();
  const res = await client.fetch(url(objectKey), { method: "PUT", body: new Uint8Array(encrypt(pdf)), headers: { "content-type": "application/octet-stream" } });
  if (!res.ok) throw new Error(`R2 upload failed: ${res.status} ${await res.text().catch(() => "")}`);
}

export async function getResume(objectKey: string): Promise<Buffer> {
  const { client, url } = r2();
  const res = await client.fetch(url(objectKey));
  if (!res.ok) throw new Error(`R2 download failed: ${res.status}`);
  return decrypt(Buffer.from(await res.arrayBuffer()));
}

export async function deleteResume(objectKey: string): Promise<void> {
  const { client, url } = r2();
  const res = await client.fetch(url(objectKey), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed: ${res.status}`);
}
