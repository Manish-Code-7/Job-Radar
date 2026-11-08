# Job Radar

Openings for Indian freshers and people with 0–2 years' experience, taken **only from each hiring company's own careers portal**, verified open every day, and (from Phase 2) matched to each user's resume.

Everything runs on free tiers and open-source software. The Firecrawl free account (1,000 credits/month) and the Apify free account ($5/month) are used only as a rationed "heavy tools" budget. Our own crawler always runs first, and the system keeps working when both budgets are spent.

```
apps/web        Next.js 15 (App Router) · Tailwind v4 · shadcn-style UI · tRPC v11 · Better Auth  → admin console, ingest API, Apply click
apps/worker     Node 22 · pg-boss · Crawlee/Playwright · got-scraping                             → crawl, verify, detect, audit
packages/core   adapters · classifier · verification agent · budget router · polite fetcher (pure, Vitest)
packages/db     Drizzle ORM · Postgres 16 + pgvector · snapshot ingest
```

## Architecture

```mermaid
flowchart LR
  subgraph VM["Oracle Cloud Always Free Arm VM (Docker Compose)"]
    W["worker<br/>pg-boss queues + cron"]
    PW["Playwright<br/>(Crawlee BrowserPool)"]
    PG[("Postgres 16<br/>+ pgvector<br/>+ pg-boss")]
    WEB["web (Next.js)<br/>admin · ingest API · Apply click"]
    OL["Ollama (Phase 2)<br/>resume parsing"]
    BK["backup<br/>nightly pg_dump"]
    CF["cloudflared"]
    W --> PW
    W <--> PG
    WEB <--> PG
    BK --> PG
    CF --> WEB
  end
  subgraph ATS["Company careers portals"]
    API["API tier<br/>Lever · Greenhouse · Ashby · SmartRecruiters<br/>Workable · Recruitee · Amazon"]
    WD["Workday CXS · Oracle ORC"]
    BR["Browser tier<br/>iCIMS · SuccessFactors · Phenom · Keka · Kula<br/>Darwinbox · Zoho · Freshteam · custom"]
  end
  W -- "polite HTTP (robots, 1 req/domain, 2–5 s)" --> API
  W -- "got-scraping → Playwright capture" --> WD
  PW --> BR
  GHA["GitHub Actions<br/>crawl --shard N"] -- "API tier only" --> API
  GHA -- "POST /api/ingest/snapshot" --> WEB
  W -. "budget router: last resort" .-> FC["Firecrawl free<br/>1,000 credits/mo"]
  W -. "budget router: blocked tenants" .-> AP["Apify free<br/>$5/mo"]
  W -. "free fallback" .-> JR["Jina Reader"]
  W -. "public job text only" .-> GM["Gemini free tier"]
  BK --> R2[("Cloudflare R2")]
  U(("Users")) --> CFE["Cloudflare edge"] --> CF
```

## How a job gets onto the site

1. **Crawl** (`crawl:company`, daily at the company's `crawlHour` in IST). The adapter returns a snapshot of the board. Workday and Oracle use the tenant's **India location facet**, so most of them give a *complete* India snapshot.
2. **Ingest.** New jobs are classified (rules first, then Gemini only to fill gaps) and stored as `pending`. Jobs outside India are stored as `archived`, so they are never fetched again.
3. **Verify (S1).** A job present in a successful snapshot is `open`. A job missing from a *complete* snapshot is `closed`. Partial snapshots (search-filtered, link-discovered) never close anything.
4. **Verify (S2–S4)** for whatever S1 couldn't decide: HTTP probe with manual redirects, then a rendered check, then an identity check. The rendered check escalates: own Playwright → Firecrawl (budgeted) → Jina Reader → `unknown`.
5. **Audit (S5).** Every night 30 random open jobs get an Apply click. The false-open rate is tracked per ATS, and any ATS above 5% must pass S3 from then on.
6. **Display.** "Verified open · checked Xh ago" < 36h · "Rechecking" 36–72h · hidden > 72h · archived after 21 days.

Rules that always hold:
- A failed or blocked fetch never closes a job.
- A metadata-only page (an SPA shell, even one with JSON-LD) never counts as open.
- `closed` needs either a complete-snapshot miss, a definitive ATS "not found" (Greenhouse `?error=true`), or two closed observations ≥ 6 h apart.

## Quick start (local)

Requires Node 22+, pnpm 9 and Docker.

```bash
cp .env.example .env              # set ADMIN_EMAILS, BETTER_AUTH_SECRET, INGEST_TOKEN
pnpm install
docker compose up -d postgres     # PG_HOST_PORT=5433 if 5432 is taken locally
export DATABASE_URL=postgres://jobradar:jobradar@localhost:5432/jobradar
pnpm db:migrate
pnpm seed                         # imports data/directory.json (idempotent)
#   …or the 12-company sample:  pnpm worker seed --file data/directory.sample.json
pnpm --filter @job-radar/worker exec playwright install chromium

pnpm worker crawl --company Groww --dry      # API tier: print, write nothing
pnpm worker crawl --company NVIDIA --dry     # Workday
pnpm worker crawl --company "SAP Labs India" --dry   # browser tier
pnpm worker detect --pending                 # ATS detector for `unknown` companies
pnpm worker report --sample 50 --apply 10    # verification report → reports/
pnpm worker start                            # long-running pg-boss worker
pnpm dev:web                                 # http://localhost:3000/admin (sign in with an ADMIN_EMAILS address; OTP is printed to the console without SMTP)

pnpm typecheck && pnpm test
```

Everything at once: `docker compose up -d --build`, which runs postgres, migrate, worker, web and backup. Add `--profile tunnel` for cloudflared and `--profile ai` for Ollama.

## Deploying on Oracle Cloud Always Free (Arm)

The Always Free Arm allowance is now **2 OCPU / 12 GB RAM** (Oracle halved it in 2026), plus a 200 GB block volume. Idle Always Free instances can be reclaimed; the daily crawl keeps this one busy.

1. **Create the VM.** Ubuntu 24.04 on `VM.Standard.A1.Flex`, 2 OCPU / 12 GB, with a 100–200 GB boot volume and your SSH key.
2. **Install Docker:**
   ```bash
   sudo apt-get update && sudo apt-get install -y ca-certificates curl
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   ```
3. **Add a swap file** (Chromium spikes, and a 4 GB buffer avoids OOM kills):
   ```bash
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf && sudo sysctl --system
   ```
4. **Set up the firewall.** Open nothing publicly: Cloudflare Tunnel dials out, and Postgres and web listen on 127.0.0.1 only. In the OCI security list, keep only port 22 (better, restricted to your IP). On the host:
   ```bash
   sudo iptables -L INPUT --line-numbers   # Oracle's Ubuntu image already drops everything except 22
   ```
5. **Deploy:**
   ```bash
   git clone <your repo> job-radar && cd job-radar
   cp .env.example .env && nano .env        # real secrets; PLATFORM=linux/arm64
   docker compose up -d --build
   docker compose exec worker pnpm seed
   docker compose logs -f worker
   ```

### Cloudflare Tunnel

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create a tunnel* (cloudflared). Copy the token.
2. Add a public hostname, `jobradar.example.com`, pointing to `http://web:3000`.
3. Put `CLOUDFLARE_TUNNEL_TOKEN=…` in `.env`, then run `docker compose --profile tunnel up -d cloudflared`.
4. Set `BETTER_AUTH_URL=https://jobradar.example.com` and restart `web`.

### Backups to Cloudflare R2

The `backup` container runs `pg_dump --format=custom` at 03:30 IST and uploads to `s3://$R2_BUCKET/backups/`, keeping the newest 14 dumps. `raw_payloads` is excluded, since it's 30-day debug data.

- **Create the bucket:** R2 → create the bucket, then an API token with *Object Read & Write* on that bucket only, and fill in the `R2_*` variables.
- **Test it:** `docker compose exec backup /backup.sh`
- **Restore:** `pg_restore --clean --if-exists -d "$DATABASE_URL" jobradar-YYYYMMDD-HHMM.dump`

## GitHub Actions crawl pool

`.github/workflows/crawl.yml` runs `worker crawl --shard N --of 4` every 6 h on GitHub's runners. That gives a second IP pool, and minutes are unlimited on a **public** repo.

- The runner has **no database access**. It fetches its shard from `GET /api/ingest/companies` and posts each snapshot to `POST /api/ingest/snapshot`, authenticated with `INGEST_TOKEN`. The web app applies the same ingest code the VM uses.
- It only crawls API-tier companies; browser-tier sites stay on the VM. The snapshot endpoint drops any job whose URL host isn't the company's domain or a known ATS host, and a snapshot with dropped jobs is treated as incomplete.
- **Setup:** add the repo secrets `INGEST_URL` (`https://<your host>/api/ingest`) and `INGEST_TOKEN`, and the variable `CRAWL_CONTACT_URL`. Keep secrets out of code; this repo is meant to be public.

## Budget router (Firecrawl + Apify free accounts)

All budget logic lives in `packages/core/src/budget`:

- **Ledger.** `provider_usage` records Firecrawl credits and Apify USD. Apify usage is read back from the run's `usageTotalUsd`.
- **Allowance.** `(cap − used before today) / days left incl. today`, in IST. Unused days roll over within the month, and spending stops at 100% of the cap.
- **Priorities.**
  - P1 (user-triggered checks) may borrow from the rest of the month.
  - P2 (verifying jobs already shown to users) gets 100% of today's allowance.
  - P3 (blocked high-priority tenants) gets 70%.
  - P4 (onboarding) gets 50%.
  - P5 (everything else) gets 30%.
- **Concurrency and caching.** Firecrawl runs at most 2 concurrent calls. 429s back off without being charged, and results (and failures) are cached per URL for 6 h.
- **Escalation chains.**
  - **Verify a job page:** own HTTP → own Playwright → Firecrawl `scrape` (1 credit) → Jina Reader → `unknown`.
  - **List a blocked Workday/iCIMS/SuccessFactors tenant:** own adapter → own Playwright capture → Apify actor (`postedWithinDays: 3`, with a full run at most weekly) → skip until tomorrow.
  - **Detect a new company's ATS:** own Playwright → Firecrawl `scrape` (links + rawHtml).
- **Alerts.** The admin Health page shows used vs cap, today's allowance, days left and projected month-end, and alerts at 80%.

Before relying on Apify's free plan, confirm in your account that API access and the actor you choose work on it. Use **one** account per service: both services' terms forbid multiplying free accounts.

## Free-tier limits and what to upgrade first

| Limit you will hit | Symptom in /admin | First upgrade (≈ cost) |
|---|---|---|
| One outbound IP gets rate-limited/blocked by big portals | "Blocked domains", failing adapters, `blocked` crawl runs | Run more of the API tier on the GitHub Actions pool (free). Then a second ₹400–600/month VPS as another worker (same Docker Compose, `WORKER_NAME=fallback`). |
| 2 OCPU running 3–4 Chromiums | crawl queue backlog, render timeouts | `BROWSER_CONCURRENCY=2`, more of the API tier on GHA; then a 4 vCPU / 8 GB VPS (₹800–1,000/month). |
| Firecrawl 1,000 credits | Firecrawl card ≥ 80% | Firecrawl Hobby only if user-triggered checks are being denied; otherwise lean on Jina. |
| Gemini free quota / data-use terms | Gemini card ≥ 80% | Rules already work alone. A paid Gemini key (no training on data) once revenue starts. |
| Oracle reclaims or shrinks the free VM | site down | Everything is in Docker Compose plus R2 backups: restore onto any VPS in an afternoon. |
| Email free tier (~300/day) | Phase 3 digests capped | Telegram first (free); a paid Brevo/Resend plan later. |

## Adapters

| ATS | Tier | Listing | Snapshot complete? | Verified against live data |
|---|---|---|---|---|
| Lever | api | `api.lever.co/v0/postings/<slug>?mode=json` | yes | ✓ (CRED, Meesho) |
| Greenhouse | api | `boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true` | yes | ✓ (Groww, Razorpay) |
| Ashby | api | `api.ashbyhq.com/posting-api/job-board/<slug>` | yes | ✓ (Sarvam AI) |
| SmartRecruiters | api | `/v1/companies/<id>/postings` + detail for new jobs | yes (≤ 2,000) | ✓ fixture (Bosch) |
| Workable | api | `apply.workable.com/api/v1/widget/accounts/<slug>?details=true` | yes | ✓ fixture (Hugging Face) |
| Recruitee | api | `<slug>.recruitee.com/api/offers/` | yes | ✓ fixture (bunq) |
| Amazon | api | `amazon.jobs/en/search.json` (`normalized_country_code[]=IND`, tech categories) | yes | ✓ |
| Workday | api → browser | CXS `POST …/jobs` with India facet (got-scraping) → Playwright network capture on 403 | yes when India ≤ 500 | ✓ (NVIDIA) |
| Oracle Recruiting | api | `hcmRestApi … recruitingCEJobRequisitions` with India location facet | yes when India ≤ 500 | ✓ (JPMorgan Chase) |
| SuccessFactors · iCIMS · Phenom · Keka · Kula · Darwinbox · Zoho · Freshteam · Google · custom | browser | sitemap → links on the careers page (rendered when needed) → JSON-LD → selectors → Gemini | no (link discovery) | SuccessFactors live (SAP: partial, it rate-limits our bot); the others are pattern-based and need a real tenant from the directory to confirm |

## Engineering rules

- We never publish full job descriptions. We store and show our own ≤ 600-character summary and link out to apply.
- We never scrape LinkedIn, Naukri, Indeed, Glassdoor or other aggregators. Jobs only come from adapters.
- The crawler identifies itself as `JobRadarBot/1.0 (+CRAWL_CONTACT_URL)`, respects robots.txt (cached 24 h), sends one request at a time per domain with a 2–5 s jittered gap, backs off on 403/429/5xx (honouring Retry-After), uses ETag/Last-Modified, and has a per-domain circuit breaker.
- Every external call has a timeout and typed errors (`FetchError.kind`). Every crawl and verify run is recorded (`crawl_runs`, `job_checks`).
- Images build for `linux/arm64`.
