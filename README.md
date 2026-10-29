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

## Seller approval

Each target contact has an approval status: `pending` (the default), `approved`, or `rejected`. The seller
approves or rejects contacts in the workspace, one at a time or in bulk. Emails are enriched only after
approval, and the database enforces this: a check constraint rejects any write that stores an email, or
sets `email_status` to `enriched` or `unavailable`, on a contact that isn't approved. Rejecting a contact
clears any email already stored for it.

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
npx wrangler secret put SUPABASE_SECRET_KEY
```

The model is set by `NVIDIA_MODEL` in `wrangler.jsonc` (currently `nvidia/nemotron-3.5-lightning-30b-a3b`,
called at `https://integrate.api.nvidia.com/v1`).

### Chat endpoint

`/api/chat` sends one message to the NVIDIA model and returns its final answer, with any reasoning
removed. From a browser (after the Cloudflare Access login):
`/api/chat?message=Hello`. From code: `POST /api/chat` with `{"message": "Hello"}`. Both return
`{"model": "...", "reply": "..."}`. Without the `NVIDIA_API_KEY` secret it returns a 503.

### Research agent

`/research/` runs the account research agent on one ticker. The NVIDIA model decides which filings to
read with these tools: list and read 8-Ks, search and read 10-K sections, list Form 3s, and, when
`SEC_USER_AGENT` is set, list EDGAR filings and read their documents (10-Q MD&A, 8-K exhibits). It
records evidence with `record_signal`, and code rejects any quote that isn't in text the agent actually
read, or any filing outside the 12-month window. Scoring uses `src/shared/scoring.ts`. A run is capped
at 14 model turns and 6 EDGAR documents, and progress streams to the page as newline-delimited JSON
from `POST /api/research`.

It needs the `NVIDIA_API_KEY` and `MASSIVE_API_KEY` secrets. `SEC_USER_AGENT` is optional: SEC
requires a name and contact email on each request, e.g. `Jane Doe jane@example.com`, so it's kept as a
secret rather than in the code.

### Database

Run the files in `supabase/migrations/` in order in the Supabase SQL editor, or run `supabase db push`:

1. `0001_init.sql`: tables, enums, row-level security
2. `0002_target_contact_approval.sql`: seller approval on `target_contacts`

To test with fictional data, run `supabase/seed/sample_accounts.sql` the same way. It's safe to run
more than once, and its header has the one-line command that removes the sample data.

Each migration runs in a single transaction. Row-level security is on with no policies, so only the
Worker's Supabase secret key can read the data. Once `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set,
`/api/accounts` reads from Supabase instead of the sample data, and approvals are saved there.

## Deploy

Deploys run through **Cloudflare Workers Builds**, connected to this repository:

| Setting        | Value                  |
| -------------- | ---------------------- |
| Worker name    | `usf-sales-agent-poc` (must match `name` in `wrangler.jsonc`) |
| Build command  | `npm run build`        |
| Deploy command | `npx wrangler deploy`  |
| Node version   | 22 (from `.node-version`) |

Runtime secrets go in the dashboard under the Worker's **Settings → Variables and Secrets**, with the
type set to **Secret**: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NVIDIA_API_KEY`, `MASSIVE_API_KEY`, and
`SEC_USER_AGENT`. Each
`wrangler deploy` replaces plain-text variables with the ones in `wrangler.jsonc` but keeps secrets.

Only `main` deploys to production. Pull-request branches build as previews with `npx wrangler preview`,
using the `previews` block in `wrangler.jsonc`. Previews get no secrets, so they show sample data and
can't reach Supabase or call NVIDIA.

To deploy from your own machine instead: `npx wrangler login`, then `npm run deploy`.

> **Before adding the secrets:** the API has no authentication of its own. Put the Worker's hostname
> behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) first.
> Without it, anyone with the URL could read your network and target contacts, approve or reject
> contacts, or spend LLM credits.

## Not built yet

- LinkedIn connections CSV import and matching against the S&P 1500 universe
- Running the research agent for every matched company in the background, and saving its findings to Supabase
- Apollo contact search along the role ladder, and email enrichment after approval, within credits
- Scoped for a future version: AI team benchmarks and peer comparisons (these need paid data)
