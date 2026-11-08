/** Transport abstraction so core stays pure/testable and the worker can plug in got-scraping. */
export interface HttpRequest {
  url: string;
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  /** Manual = do not follow redirects (the caller inspects Location). */
  redirect?: "follow" | "manual";
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export type FetchErrorKind =
  | "timeout"
  | "network"
  | "circuit_open"
  | "robots_disallowed"
  | "http"
  | "blocked"; // 403 / Cloudflare challenge after retries

export class FetchError extends Error {
  constructor(
    public readonly kind: FetchErrorKind,
    message: string,
    public readonly url: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export function isFetchError(e: unknown): e is FetchError {
  return e instanceof FetchError;
}

function lowerHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => (out[k.toLowerCase()] = v));
  return out;
}

/** Native fetch-based client with timeout + typed errors. */
export const nativeHttpClient: HttpClient = {
  async request(req) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 20_000);
    try {
      const res = await fetch(req.url, {
        method: req.method ?? "GET",
        headers: req.headers,
        body: req.body,
        redirect: req.redirect ?? "follow",
        signal: ctrl.signal,
      });
      const body = await res.text();
      return { status: res.status, url: res.url || req.url, headers: lowerHeaders(res.headers), body };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new FetchError("timeout", `timeout ${req.url}`, req.url);
      throw new FetchError("network", (e as Error).message, req.url);
    } finally {
      clearTimeout(timer);
    }
  },
};

export function looksLikeChallenge(res: HttpResponse): boolean {
  if (res.status !== 403 && res.status !== 503 && res.status !== 429) return false;
  const server = res.headers["server"] ?? "";
  return (
    /cloudflare/i.test(server) ||
    /cf-chl|challenge-platform|Just a moment\.\.\.|Attention Required/i.test(res.body.slice(0, 5000))
  );
}
