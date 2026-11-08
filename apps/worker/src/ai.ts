import { AiEnrichmentSchema, type AiEnrichment, type AiExtractor, type JobEnricher, type RawJob } from "@job-radar/core";
import { aiCache, eq, providerUsage, sql, type Db } from "@job-radar/db";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { env } from "./env";
import { warn } from "./log";

/**
 * Gemini free tier — PUBLIC JOB POSTINGS ONLY. Google may use free-tier inputs/outputs and humans may read
 * them, so this class never receives resumes or any user data. Rate-limited (RPM) and capped per day.
 */
export class GeminiJobAi implements JobEnricher, AiExtractor {
  private ai: GoogleGenAI;
  private lastCall = 0;
  constructor(private db: Db) {
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! });
  }

  static maybe(db: Db): GeminiJobAi | undefined {
    return env.GEMINI_API_KEY ? new GeminiJobAi(db) : undefined;
  }

  private async underBudget(): Promise<boolean> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(providerUsage)
      .where(sql`${providerUsage.provider} = 'gemini' and ${providerUsage.at} > now() - interval '1 day'`);
    return (r?.n ?? 0) < env.GEMINI_DAILY_REQUESTS;
  }

  private async call(task: string, prompt: string, schema: Record<string, unknown>): Promise<unknown | null> {
    if (!(await this.underBudget())) return null;
    const gap = 60_000 / env.GEMINI_RPM - (Date.now() - this.lastCall);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    this.lastCall = Date.now();
    try {
      const res = await this.ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
      });
      await this.db.insert(providerUsage).values({ provider: "gemini", units: 1, task });
      return JSON.parse(res.text ?? "null");
    } catch (e) {
      warn("gemini call failed", { task, err: (e as Error).message });
      return null;
    }
  }

  async enrich(input: { title: string; company: string; text: string; descriptionHash: string }): Promise<AiEnrichment | null> {
    const key = `${env.GEMINI_MODEL}:enrich:${input.descriptionHash}`;
    const [hit] = await this.db.select().from(aiCache).where(eq(aiCache.key, key));
    if (hit) return AiEnrichmentSchema.safeParse(hit.value).data ?? null;
    const prompt = `You classify public job postings for Indian freshers (0–2 years' experience).
Return JSON with:
- skills: up to 12 concrete technical skills the posting asks for
- track: one of software, ai_ml, devops, data, qa, other
- freshersEligible: true only if someone with 0–2 years of full-time experience could realistically be hired
- summary: 2 neutral sentences in your own words (no copying), ≤ 400 characters, no hype

Title: ${input.title}
Company: ${input.company}
Posting:
${input.text}`;
    const out = await this.call("classify", prompt, {
      type: "object",
      properties: {
        skills: { type: "array", items: { type: "string" } },
        track: { type: "string", enum: ["software", "ai_ml", "devops", "data", "qa", "other"] },
        freshersEligible: { type: "boolean" },
        summary: { type: "string" },
      },
      required: ["skills", "track", "freshersEligible", "summary"],
    });
    const parsed = AiEnrichmentSchema.safeParse(out);
    if (!parsed.success) return null;
    await this.db.insert(aiCache).values({ key, value: parsed.data }).onConflictDoNothing();
    return parsed.data;
  }

  async extractJob(text: string, url: string): Promise<Partial<RawJob> | null> {
    const Out = z.object({
      isJobPosting: z.boolean(),
      title: z.string().optional(),
      locations: z.array(z.string()).optional(),
      employmentType: z.string().optional(),
      workplace: z.string().optional(),
    });
    const out = await this.call(
      "extract",
      `Is this page a single job posting? If so extract its title, locations, employment type and workplace (onsite/hybrid/remote). Do not guess.\nURL: ${url}\n\n${text}`,
      {
        type: "object",
        properties: {
          isJobPosting: { type: "boolean" },
          title: { type: "string" },
          locations: { type: "array", items: { type: "string" } },
          employmentType: { type: "string" },
          workplace: { type: "string" },
        },
        required: ["isJobPosting"],
      },
    );
    const p = Out.safeParse(out);
    if (!p.success || !p.data.isJobPosting || !p.data.title) return null;
    return { title: p.data.title, locations: p.data.locations ?? [], employmentTypeHint: p.data.employmentType, workplaceHint: p.data.workplace };
  }
}
