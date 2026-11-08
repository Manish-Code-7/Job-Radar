import { env } from "./env";
import { warn } from "./log";

type Extractor = (texts: string[], opts: { pooling: "mean" | "cls"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
let extractor: Promise<Extractor | null> | null = null;

/** Local CPU embeddings (bge-small, 384-d). Nothing leaves the server. Returns null if disabled/unavailable. */
export async function embed(texts: string[]): Promise<number[][] | null> {
  if (env.EMBEDDINGS === "off" || !texts.length) return null;
  extractor ??= import("@huggingface/transformers")
    .then((m) => m.pipeline("feature-extraction", env.EMBEDDING_MODEL, { dtype: "q8" }) as unknown as Promise<Extractor>)
    .catch((e) => {
      warn("embeddings unavailable", { err: (e as Error).message });
      return null;
    });
  const ex = await extractor;
  if (!ex) return null;
  const out = await ex(texts, { pooling: "cls", normalize: true });
  return out.tolist();
}

export function jobEmbeddingText(j: { title: string; summary?: string | null; skills: string[] }): string {
  return `${j.title}. ${j.skills.join(", ")}. ${j.summary ?? ""}`.slice(0, 1000);
}
