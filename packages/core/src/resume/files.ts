import { inflateRawSync } from "node:zlib";

/** True if a PDF signature appears in the first 1 KB (some exporters prepend junk bytes). */
export function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 1024).includes(Buffer.from("%PDF-"));
}

/** .docx is a zip; check the local-file-header magic and the Word part name. */
export function isDocx(buf: Buffer): boolean {
  return buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && buf.includes(Buffer.from("word/document.xml"));
}

/** Minimal zip reader (central directory → word/document.xml) so .docx needs no extra dependency. */
export function docxToText(buf: Buffer): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (name === "word/document.xml") {
      const lName = buf.readUInt16LE(local + 26);
      const lExtra = buf.readUInt16LE(local + 28);
      const data = buf.subarray(local + 30 + lName + lExtra, local + 30 + lName + lExtra + csize);
      const xml = (method === 8 ? inflateRawSync(data) : data).toString("utf8");
      return xml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br[^>]*\/>|<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, "\n\n");
    }
    p += 46 + nameLen + extra + comment;
  }
  throw new Error("word/document.xml not found");
}

