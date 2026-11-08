/** Browser abstraction. The worker implements it with Crawlee/Playwright; tests use fakes. */
export interface CapturedJson {
  url: string;
  status: number;
  body: unknown;
}

export interface RenderedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  html: string;
  text: string;
  title: string;
  links: { href: string; text: string }[];
  /** Absolute URLs of every network request (scripts, iframes, XHR) — used by the ATS detector. */
  requestUrls: string[];
  frameUrls: string[];
  /** JSON responses whose URL matched `captureJson`. */
  json: CapturedJson[];
}

export interface RenderOptions {
  captureJson?: RegExp;
  /** Scroll to bottom N times (infinite lists). */
  scrolls?: number;
  /** Click this selector repeatedly ("Load more", next page) up to `maxClicks`. */
  clickSelector?: string;
  maxClicks?: number;
  waitMs?: number;
  timeoutMs?: number;
}

export type ApplyProbeOutcome = "form" | "login" | "external_ats" | "closed" | "no_button" | "error";

export interface ApplyProbeResult {
  outcome: ApplyProbeOutcome;
  finalUrl?: string;
  detail?: string;
}

export interface BrowserDriver {
  render(url: string, opts?: RenderOptions): Promise<RenderedPage>;
  applyProbe(url: string): Promise<ApplyProbeResult>;
  close?(): Promise<void>;
}
