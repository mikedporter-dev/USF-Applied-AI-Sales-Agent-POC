# Inroad: AI sales agent POC

A proof of concept for business development leaders who sell AI transformation services to enterprises.
It starts from the seller's network, scores S&P Composite 1500 companies on 12 months of public SEC
filings, and ranks the accounts that are ready to buy. For each account it shows why it ranks, why now,
who can get the seller in, and who to reach.

> **Status:** the UI, scoring engine, Worker API, and database schema are built. The current data is
> **fictional sample data**. The Massive, SEC EDGAR, LinkedIn import, and Apollo integrations are not
> connected yet. NVIDIA and Supabase are wired up and turn on when their secrets are set.

## Stack

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Hosting  | Cloudflare Workers with static assets                       |
| Frontend | Vite + React + TypeScript (`/` landing, `/app/` workspace)  |
| API      | Cloudflare Worker (`worker/`), serves `/api/*` only         |
| LLM      | NVIDIA API (OpenAI-compatible, `integrate.api.nvidia.com`)  |
| Database | Supabase Postgres (`supabase/migrations/`)                  |

```
src/shared/       scoring engine, domain types, sample data (used by browser and Worker)
src/landing/      marketing page
src/app/          ranked account workspace
src/components/   shared UI pieces
worker/           Cloudflare Worker: /api/health, /api/accounts, /api/accounts/:cik/brief
supabase/         SQL schema
```

## Scoring

Defined in `src/shared/scoring.ts`, with every weight in one place:

- **Fit (30%)**: revenue band and GICS sector.
- **Intent (40%)**: concrete AI commitments, leadership changes, acquisitions, restructurings, AI-driven reorgs.
- **Gap (30%)**: AI pilots with no reported results, and stated ambition with no outcomes yet.
- **Demotion**: companies already publishing large-scale AI results get their score multiplied by 0.6.
- **Tiers**: Tier 1 is 65 and up, Tier 2 is 45 and up. The outreach list takes Tier 1 first and fills
  with Tier 2, up to 100 accounts.
- Only signals from the trailing 12 months count. Companies with no Manager+ connection are not scored.

## Develop

```bash
npm install
```

Build the site and run it on Cloudflare's local runtime, with the API, at http://localhost:8787:

```bash
npm run preview
```

For frontend work with hot reload, run `vite` on :5173. It proxies `/api` to `wrangler dev` on :8787.
If the Worker isn't running, the app falls back to sample data in the browser.

```bash
npm run dev
```

Checks:

```bash
npm run typecheck && npm test
```

### Secrets

Copy `.dev.vars.example` to `.dev.vars` for local development. It is git-ignored. In production:

```bash
npx wrangler secret put NVIDIA_API_KEY
```

```bash
npx wrangler secret put SUPABASE_URL
```

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

The model is set by `NVIDIA_MODEL` in `wrangler.jsonc`.

### Database

Apply `supabase/migrations/0001_init.sql` in the Supabase SQL editor, or run `supabase db push`.
Row-level security is on with no policies, so only the Worker's service-role key can read the data.
Once `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, `/api/accounts` reads from Supabase
instead of the sample data.

## Deploy

```bash
npx wrangler login
```

```bash
npm run deploy
```

> **Before loading real data:** the API has no authentication yet. Put the Worker behind
> [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) before it holds
> real network data or an NVIDIA key, because anyone with the URL could read the accounts or spend LLM
> credits.

## Not built yet

- LinkedIn connections CSV import and matching against the S&P 1500 universe
- Massive and SEC EDGAR ingestion, with LLM extraction of signals from filing text
- Apollo contact search along the role ladder, and email enrichment after approval, within credits
- Saving approvals to Supabase
- Scoped for a future version: AI team benchmarks and peer comparisons (these need paid data)
