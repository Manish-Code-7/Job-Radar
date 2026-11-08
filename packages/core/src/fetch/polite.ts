import { FetchError, looksLikeChallenge, type HttpClient, type HttpRequest, type HttpResponse } from "./http";
import { ALLOW_ALL, parseRobots, type Robots } from "./robots";

export interface DomainState {
  domain: string;
  lastRequestAt?: number;
  consecutiveErrors: number;
  blockedUntil?: number;
  robotsTxt?: string | null; // null = none / unreachable (allow all)
  robotsFetchedAt?: number;
}

export interface DomainStateStore {
  get(domain: string): Promise<DomainState | undefined>;
  set(state: DomainState): Promise<void>;
}

export class MemoryDomainStateStore implements DomainStateStore {
  private m = new Map<string, DomainState>();
  async get(d: string) {
    return this.m.get(d);
  }
  async set(s: DomainState) {
    this.m.set(s.domain, { ...s });
  }
}

interface CacheEntry {
  etag?: string;
  lastModified?: string;
  response: HttpResponse;
}
export interface ConditionalCache {
  get(url: string): Promise<CacheEntry | undefined>;
  set(url: string, e: CacheEntry): Promise<void>;
}
export class MemoryConditionalCache implements ConditionalCache {
  private m = new Map<string, CacheEntry>();
  async get(u: string) {
    return this.m.get(u);
  }
  async set(u: string, e: CacheEntry) {
    if (this.m.size > 5000) this.m.delete(this.m.keys().next().value!);
    this.m.set(u, e);
  }
}

export interface PoliteOptions {
  http: HttpClient;
  contactUrl: string;
  store?: DomainStateStore;
  cache?: ConditionalCache;
  minDelayMs?: number;
  maxDelayMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  /** Consecutive failures that open the circuit. */
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  robotsTtlMs?: number;
  respectRobots?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export const USER_AGENT = (contact: string) => `JobRadarBot/1.0 (+${contact})`;

const RETRYABLE = new Set([403, 429, 500, 502, 503, 504]);

export function domainOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export function parseRetryAfter(v: string | undefined, now: number): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : undefined;
}

/**
 * One in-flight request per domain, jittered gap between requests, robots.txt,
 * exponential backoff honouring Retry-After, ETag/Last-Modified, circuit breaker.
 */
export class PoliteFetcher {
  private chains = new Map<string, Promise<unknown>>();
  private o: Required<Omit<PoliteOptions, "log">> & { log: NonNullable<PoliteOptions["log"]> };

  constructor(opts: PoliteOptions) {
    this.o = {
      store: new MemoryDomainStateStore(),
      cache: new MemoryConditionalCache(),
      minDelayMs: 2000,
      maxDelayMs: 5000,
      maxRetries: 3,
      baseBackoffMs: 2000,
      breakerThreshold: 5,
      breakerCooldownMs: 6 * 3600_000,
      robotsTtlMs: 24 * 3600_000,
      respectRobots: true,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      random: Math.random,
      log: () => {},
      // Explicitly-undefined options (e.g. `store: undefined` when there is no database) keep the default.
      ...(Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as PoliteOptions),
    };
  }

  get userAgent() {
    return USER_AGENT(this.o.contactUrl);
  }

  /** Serialise per domain. */
  private withDomainLock<T>(domain: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(domain) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(
      domain,
      next.catch(() => {}),
    );
    return next;
  }

  private async robotsFor(domain: string, protocol: string): Promise<Robots> {
    if (!this.o.respectRobots) return ALLOW_ALL;
    const st = (await this.o.store.get(domain)) ?? { domain, consecutiveErrors: 0 };
    const now = this.o.now();
    if (st.robotsFetchedAt === undefined || now - st.robotsFetchedAt > this.o.robotsTtlMs) {
      let txt: string | null = null;
      try {
        const res = await this.o.http.request({
          url: `${protocol}//${domain}/robots.txt`,
          headers: { "user-agent": this.userAgent },
          timeoutMs: 10_000,
        });
        // 4xx = no restrictions; 5xx = treat as allow (we stay conservative via throttling).
        txt = res.status >= 200 && res.status < 300 ? res.body : null;
      } catch {
        txt = null;
      }
      st.robotsTxt = txt;
      st.robotsFetchedAt = now;
      await this.o.store.set(st);
    }
    return st.robotsTxt ? parseRobots(st.robotsTxt, this.userAgent) : ALLOW_ALL;
  }

  async isAllowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const robots = await this.robotsFor(u.hostname.toLowerCase(), u.protocol);
    return robots.isAllowed(u.pathname + u.search);
  }

  async fetch(req: HttpRequest & { useCache?: boolean; skipRobots?: boolean }): Promise<HttpResponse> {
    const u = new URL(req.url);
    const domain = u.hostname.toLowerCase();
    return this.withDomainLock(domain, async () => {
      const now0 = this.o.now();
      let st = (await this.o.store.get(domain)) ?? { domain, consecutiveErrors: 0 };
      if (st.blockedUntil && st.blockedUntil > now0) {
        throw new FetchError("circuit_open", `circuit open for ${domain}`, req.url, undefined, st.blockedUntil - now0);
      }
      const robots = req.skipRobots ? ALLOW_ALL : await this.robotsFor(domain, u.protocol);
      if (!robots.isAllowed(u.pathname + u.search)) {
        throw new FetchError("robots_disallowed", `robots.txt disallows ${u.pathname}`, req.url);
      }
      st = (await this.o.store.get(domain)) ?? st;

      const headers: Record<string, string> = {
        "user-agent": this.userAgent,
        accept: "application/json, text/html;q=0.9, */*;q=0.8",
        ...req.headers,
      };
      const cacheable = req.useCache !== false && (req.method ?? "GET") === "GET";
      const cached = cacheable ? await this.o.cache.get(req.url) : undefined;
      if (cached?.etag) headers["if-none-match"] = cached.etag;
      if (cached?.lastModified) headers["if-modified-since"] = cached.lastModified;

      let attempt = 0;
      for (;;) {
        // Politeness gap since the last request to this domain.
        const crawlDelayMs = Math.min(robots.crawlDelaySec ?? 0, 30) * 1000;
        const gap = this.o.minDelayMs + this.o.random() * (this.o.maxDelayMs - this.o.minDelayMs);
        const since = st.lastRequestAt ? this.o.now() - st.lastRequestAt : Infinity;
        const wait = Math.max(gap, crawlDelayMs) - since;
        if (wait > 0) await this.o.sleep(wait);

        st.lastRequestAt = this.o.now();
        let res: HttpResponse;
        try {
          res = await this.o.http.request({ ...req, headers });
        } catch (e) {
          await this.recordFailure(st);
          if (attempt < this.o.maxRetries && e instanceof FetchError && (e.kind === "timeout" || e.kind === "network")) {
            await this.o.sleep(this.backoff(attempt++));
            continue;
          }
          throw e;
        }

        if (res.status === 304 && cached) {
          await this.recordSuccess(st);
          return { ...cached.response, status: 200, headers: { ...cached.response.headers, "x-cache": "revalidated" } };
        }

        if (RETRYABLE.has(res.status)) {
          const retryAfter = parseRetryAfter(res.headers["retry-after"], this.o.now());
          await this.recordFailure(st);
          // A Cloudflare challenge will not clear with retries from the same IP.
          if (looksLikeChallenge(res)) {
            throw new FetchError("blocked", `challenge ${res.status} at ${domain}`, req.url, res.status, retryAfter);
          }
          if (attempt < this.o.maxRetries) {
            await this.o.sleep(Math.max(retryAfter ?? 0, this.backoff(attempt++)));
            continue;
          }
          throw new FetchError(
            res.status === 403 ? "blocked" : "http",
            `HTTP ${res.status} at ${req.url}`,
            req.url,
            res.status,
            retryAfter,
          );
        }

        await this.recordSuccess(st);
        if (cacheable && res.status === 200 && (res.headers["etag"] || res.headers["last-modified"])) {
          await this.o.cache.set(req.url, {
            etag: res.headers["etag"],
            lastModified: res.headers["last-modified"],
            response: res,
          });
        }
        return res;
      }
    });
  }

  private backoff(attempt: number) {
    return this.o.baseBackoffMs * 2 ** attempt * (0.75 + this.o.random() * 0.5);
  }

  private async recordFailure(st: DomainState) {
    st.consecutiveErrors += 1;
    if (st.consecutiveErrors >= this.o.breakerThreshold) {
      st.blockedUntil = this.o.now() + this.o.breakerCooldownMs;
      this.o.log("circuit opened", { domain: st.domain, until: st.blockedUntil });
    }
    await this.o.store.set(st);
  }

  private async recordSuccess(st: DomainState) {
    st.consecutiveErrors = 0;
    st.blockedUntil = undefined;
    await this.o.store.set(st);
  }

  /** Convenience: GET JSON. */
  async json<T = unknown>(url: string, init: Omit<HttpRequest, "url"> = {}): Promise<T> {
    const res = await this.fetch({ url, ...init });
    if (res.status < 200 || res.status >= 300) {
      throw new FetchError("http", `HTTP ${res.status} at ${url}`, url, res.status);
    }
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new FetchError("http", `invalid JSON from ${url}`, url, res.status);
    }
  }
}
