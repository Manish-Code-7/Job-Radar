import { createHash } from "node:crypto";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  bull: "•",
  rupee: "₹",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1]?.toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[g.toLowerCase()] ?? m;
  });
}

/** HTML → readable plain text. Handles Greenhouse's double-escaped HTML. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html;
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s); // escaped HTML (Greenhouse content=true)
  s = s
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function descriptionHash(title: string, text: string): string {
  return sha256(normalizeWs(title).toLowerCase() + "\n" + normalizeWs(text).toLowerCase()).slice(0, 32);
}

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

export function normalizeTitle(title: string): string {
  return tokens(
    title
      .replace(/\((m|f|d|w)\/(m|f|d|w)(\/(m|f|d|w))?\)/gi, " ")
      .replace(/\s[-–|]\s.*(india|bengaluru|bangalore|remote).*$/i, " "),
  ).join(" ");
}

export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Combined title similarity in [0,1]: the lower of token Jaccard and normalised Levenshtein. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length, 1);
  return Math.min(jaccard(na, nb), lev);
}

/** Truncate to n chars on a word boundary. */
export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 20)).trimEnd() + "…";
}
