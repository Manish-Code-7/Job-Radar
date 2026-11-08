import "server-only";
import { parseResumeRules, SKILL_DICT, type ParsedResume } from "@job-radar/core";
export { docxToText, isDocx, isPdf } from "@job-radar/core";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

export async function pdfToText(pdf: Buffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: true });
  return text;
}

const OllamaOut = z.object({
  name: z.string().optional(),
  skills: z.array(z.string()).max(40).default([]),
  education: z.string().optional(),
  gradYear: z.number().int().min(1990).max(2040).optional(),
  projects: z.array(z.object({ title: z.string(), summary: z.string().optional() })).max(10).default([]),
});

/**
 * Local LLM (Ollama) on our own server. Resumes never go to a third-party AI.
 * Experience months always come from the rules parser (date arithmetic is not an LLM job).
 */
async function parseWithOllama(text: string): Promise<z.infer<typeof OllamaOut> | null> {
  const url = process.env.OLLAMA_URL;
  if (!url) return null;
  try {
    const res = await fetch(`${url}/api/generate`, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? "qwen2.5:3b",
        stream: false,
        format: "json",
        options: { temperature: 0 },
        prompt: `Extract from this resume as JSON: {"name","skills":[technical skills only],"education":"degree, college","gradYear":number,"projects":[{"title","summary"}]}. Use only what the resume says.\n\n${text.slice(0, 12000)}`,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { response?: string };
    const parsed = OllamaOut.safeParse(JSON.parse(body.response ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // Ollama not running: rules only
  }
}

const canonical = new Map(SKILL_DICT.map(([name]) => [name.toLowerCase(), name]));

export async function parseResume(text: string): Promise<ParsedResume & { parsedBy: "ollama" | "rules" }> {
  const rules = parseResumeRules(text);
  const ai = await parseWithOllama(text);
  if (!ai) return { ...rules, parsedBy: "rules" };
  const skills = [...new Set([...rules.skills, ...ai.skills.map((s) => canonical.get(s.toLowerCase()) ?? s.trim()).filter((s) => s.length <= 40)])].slice(0, 30);
  return {
    ...rules,
    name: ai.name ?? rules.name,
    skills,
    education: ai.education ?? rules.education,
    gradYear: ai.gradYear ?? rules.gradYear,
    projects: ai.projects.length ? ai.projects.map((p) => ({ ...p, skills: [] })) : rules.projects,
    parsedBy: "ollama",
  };
}
