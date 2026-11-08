import { FetchError, nativeHttpClient, type HttpClient } from "@job-radar/core";
import { gotScraping } from "got-scraping";

/**
 * got-scraping transport: browser-like TLS + header fingerprints. Used for Workday's CXS API and other
 * portals that reject obvious bots. Our own User-Agent is kept so site owners can identify and contact us.
 */
export const gotScrapingClient: HttpClient = {
  async request(req) {
    try {
      const res = await gotScraping({
        url: req.url,
        method: req.method ?? "GET",
        headers: req.headers,
        body: req.body,
        followRedirect: req.redirect !== "manual",
        throwHttpErrors: false,
        timeout: { request: req.timeoutMs ?? 20_000 },
        retry: { limit: 0 },
        headerGeneratorOptions: { browsers: ["chrome"], operatingSystems: ["linux"], locales: ["en-IN", "en-US"] },
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
      return { status: res.statusCode, url: res.url, headers, body: res.body };
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.name === "TimeoutError" || err.code === "ETIMEDOUT") throw new FetchError("timeout", err.message, req.url);
      throw new FetchError("network", err.message, req.url);
    }
  },
};

/** Hosts that check browser fingerprints. Everything else uses plain fetch (faster, and safer for large bodies). */
const NEEDS_BROWSER_FINGERPRINT = /\.myworkday(jobs|site)\.com$/i;

export const routedHttpClient: HttpClient = {
  request(req) {
    const host = new URL(req.url).hostname;
    return (NEEDS_BROWSER_FINGERPRINT.test(host) ? gotScrapingClient : nativeHttpClient).request(req);
  },
};
