import type { ApplyProbeResult, BrowserDriver, CapturedJson, RenderedPage, RenderOptions } from "@job-radar/core";
import { BrowserPool, PlaywrightPlugin } from "crawlee";
import { chromium, type Page } from "playwright";
import { env } from "./env";
import { warn } from "./log";

const BLOCK_RESOURCES = /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|mp4|webm|ico)(\?|$)/i;

/**
 * Playwright via Crawlee's BrowserPool (browser lifecycle, retirement, fingerprints).
 * One page per call; concurrency capped so 3–4 Chromiums fit on the 12 GB VM.
 */
export class PlaywrightDriver implements BrowserDriver {
  private pool: BrowserPool;
  private active = 0;
  private waiters: (() => void)[] = [];

  constructor(
    private userAgent: string,
    private max = env.BROWSER_CONCURRENCY,
  ) {
    this.pool = new BrowserPool({
      browserPlugins: [
        new PlaywrightPlugin(chromium, {
          launchOptions: { headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] },
        }),
      ],
      maxOpenPagesPerBrowser: 4,
      retireBrowserAfterPageCount: 50,
      useFingerprints: false, // we identify as JobRadarBot rather than pretending to be a person
    });
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }

  private async newPage(): Promise<Page> {
    const page = (await this.pool.newPage()) as Page;
    await page.setExtraHTTPHeaders({ "user-agent": this.userAgent, "accept-language": "en-IN,en;q=0.9" });
    await page.route("**/*", (route) => (BLOCK_RESOURCES.test(route.request().url()) ? route.abort() : route.continue()));
    return page;
  }

  render(url: string, opts: RenderOptions = {}): Promise<RenderedPage> {
    return this.slot(async () => {
      const page = await this.newPage();
      const requestUrls: string[] = [];
      const json: CapturedJson[] = [];
      const pending: Promise<void>[] = [];
      page.on("request", (r) => requestUrls.push(r.url()));
      if (opts.captureJson) {
        const re = opts.captureJson;
        page.on("response", (res) => {
          if (!re.test(res.url())) return;
          pending.push(
            res
              .json()
              .then((body) => void json.push({ url: res.url(), status: res.status(), body }))
              .catch(() => {}),
          );
        });
      }
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
        for (let i = 0; i < (opts.scrolls ?? 0); i++) {
          await page.mouse.wheel(0, 4000);
          await page.waitForTimeout(800);
        }
        if (opts.clickSelector) {
          for (let i = 0; i < (opts.maxClicks ?? 5); i++) {
            const btn = page.locator(opts.clickSelector).first();
            if (!(await btn.isVisible().catch(() => false)) || !(await btn.isEnabled().catch(() => false))) break;
            await btn.click({ timeout: 5_000 }).catch(() => {});
            await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
            await page.waitForTimeout(2_000 + Math.random() * 2_000); // stay polite while paginating
          }
        }
        await Promise.all(pending);
        const [html, text, title, links, frameUrls] = await Promise.all([
          page.content(),
          page.evaluate(() => document.body?.innerText ?? ""),
          page.title(),
          page.$$eval("a[href]", (as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? "").trim().slice(0, 200) }))),
          Promise.resolve(page.frames().map((f) => f.url())),
        ]);
        return { requestedUrl: url, finalUrl: page.url(), status: resp?.status() ?? null, html, text, title, links, requestUrls, frameUrls, json };
      } finally {
        await page.close().catch(() => {});
      }
    });
  }

  /** Click Apply and see what happens: a form, a login wall, or a handoff to the ATS. Never submits anything. */
  applyProbe(url: string): Promise<ApplyProbeResult> {
    return this.slot(async () => {
      const page = await this.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        const hasForm = async () =>
          (await page.locator("form input[type=file], form input[type=email], input[name*=resume i], input[name*=email i]").count()) > 0;
        if (await hasForm()) return { outcome: "form", finalUrl: page.url(), detail: "form on page" };
        const APPLY = /^\s*(apply( now| for (this )?(job|position|role))?|apply online|submit (your )?application|i'?m interested|easy apply)\s*$/i;
        const apply = page.getByRole("button", { name: APPLY }).or(page.getByRole("link", { name: APPLY })).first();
        // SPAs (Oracle, Workday) render the button late.
        await apply.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
        if (!(await apply.count())) {
          const body = (await page.evaluate(() => document.body?.innerText ?? "")).toLowerCase();
          if (/no longer accepting|position has been filled|job not found|posting is closed|no longer available/.test(body)) {
            return { outcome: "closed", finalUrl: page.url() };
          }
          return { outcome: "no_button", finalUrl: page.url() };
        }
        const popup = page.context().waitForEvent("page", { timeout: 8_000 }).catch(() => null);
        // Some sites start a slow navigation on click; don't fail the probe on that, just look where we landed.
        await apply.click({ timeout: 10_000 }).catch(() => {});
        const target = (await Promise.race([popup, page.waitForTimeout(3_000).then(() => null)])) ?? page;
        await target.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
        await target.waitForTimeout(2_000);
        const finalUrl = target.url();
        const formCount = await target.locator("input[type=file], input[type=email], textarea").count();
        if (formCount > 0) return { outcome: "form", finalUrl };
        const t = (await target.evaluate(() => document.body?.innerText ?? "")).toLowerCase();
        if (/sign in|log in|login|create (an )?account|register to apply/.test(t)) return { outcome: "login", finalUrl };
        if (/myworkdayjobs|icims|successfactors|oraclecloud|greenhouse|lever\.co|ashbyhq|smartrecruiters/.test(finalUrl)) {
          return { outcome: "external_ats", finalUrl };
        }
        return { outcome: "no_button", finalUrl, detail: "clicked Apply but found no form" };
      } catch (e) {
        warn("applyProbe failed", { url, err: (e as Error).message });
        return { outcome: "error", detail: (e as Error).message };
      } finally {
        await page.close().catch(() => {});
      }
    });
  }

  async close() {
    await this.pool.destroy();
  }
}
