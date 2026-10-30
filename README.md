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
- **Intent (40%)**: concrete AI commitments, leadership changes, acquisitions, restructurings, AI-driven reorgs,
  and, at a lower weight (5 points each, 10 at most), generic AI mentions with nothing concrete behind them.
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
read, or any filing outside the 12-month window. The filing type, date and link on each signal come
from the document the quote was found in, not from the agent. Facts are filled in by code, not the
agent: the sector is mapped from the company's SIC code (`src/shared/sic.ts`, an approximation until
the S&P 1500 list supplies GICS sectors) and revenue comes from SEC's XBRL data for the latest 10-K
(needs `SEC_USER_AGENT`). Scoring uses `src/shared/scoring.ts`. A run is capped
at 16 model turns and 6 EDGAR documents. The 8-K list includes the text of key items (2.01
acquisitions, 2.05 restructurings, 5.02 officer changes), so the agent can record them without reading
each filing. Code tracks which key 8-Ks nothing was recorded from, names them in the 4-turns-left
reminder, and reminds the agent once more before it finishes; it decides whether they qualify. AI
mentions quoted from 10-K risk factors are rejected as boilerplate. A leadership change must name the
officer's role, which code checks: it must be a role that counts (CEO, CFO, COO, president, or a
technology, data, digital, AI, analytics or transformation leader), appear in the quote, and not be a
title at another company, so directors and outside executives joining the board are rejected. In the last
4 turns the agent is reminded to record what it has; if it still hasn't finished, it gets 2 wrap-up turns in which it can only record findings and
finish. Each turn resends the conversation, so large filing text older than 3 turns is replaced with a
short note (quotes from it are still checked against the full text). A model turn that takes over 90
seconds is retried once without thinking; if that fails too, the run ends with the signals recorded so
far. Progress streams to the page as newline-delimited JSON from `POST /api/research`.

It needs the `NVIDIA_API_KEY` and `MASSIVE_API_KEY` secrets. `SEC_USER_AGENT` is optional: SEC
requires a name and contact email on each request, e.g. `Jane Doe jane@example.com`, so it's kept as a
secret rather than in the code.

### Database

Run the files in `supabase/migrations/` in order in the Supabase SQL editor, or run `supabase db push`:

1. `0001_init.sql`: tables, enums, row-level security
2. `0002_target_contact_approval.sql`: seller approval on `target_contacts`
3. `0003_ai_mention_signal.sql`: the `ai_mention` signal kind (run on its own, outside a transaction)
4. `0004_universe_import.sql`: S&P 1500 import columns on `companies`
5. `0005_linkedin_connections.sql`: `companies.legal_name`; `connections.company_as_listed` and `imported_at`
6. `0006_saved_research.sql`: `research_runs`; `signals.quote` and `research_run_id`

To test with fictional data, run `supabase/seed/sample_accounts.sql` the same way. It's safe to run
more than once, and its header has the one-line command that removes the sample data.

Each migration except 0003 runs in a single transaction. Row-level security is on with no policies, so only the
Worker's Supabase secret key can read the data. Once `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set,
`/api/accounts` reads from Supabase instead of the sample data, and approvals are saved there.

### S&P Composite 1500 import

A GitHub Actions job (`.github/workflows/import-universe.yml`) runs `scripts/import-universe.ts` every
Monday and on demand (Actions → Import S&P 1500 → Run workflow). It loads every company in the three
indexes into `companies`:

- **Index membership and GICS sector** from Wikipedia's constituent lists (List of S&P 500, 400 and 600
  companies), which are kept current as S&P rebalances. iShares fund holdings would be the authoritative
  source, but iShares returns a web page instead of the file to both Cloudflare and GitHub Actions.
- **CIK** from SEC's `company_tickers.json`, matching ticker styles (BRK.B, BRK-B). A company with two
  share classes (GOOGL, GOOG) is one row.
- **Annual revenue** from SEC XBRL frames: one file per revenue tag per calendar year covers every
  filer, so revenue for all 1,500 companies takes eight requests (four tags, including the one most
  banks use, over two years).

It runs in GitHub rather than the Worker because parsing these multi-megabyte files takes far more
than the Worker's CPU budget. It needs three repository secrets (Settings → Secrets and variables →
Actions): `SEC_USER_AGENT`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Only `main` saves; pushes to other
branches run a dry run that prints the report without the Supabase secrets. An import that matches far
fewer than 1,500 companies isn't saved. Companies that leave the indexes are kept with
`in_index = false`, so their signals and connections stay. The Accounts page shows the counts, and
research uses the imported GICS sector and index membership.

### Saved research

A GitHub Actions job (`.github/workflows/research-accounts.yml`) runs the research agent every 6 hours
on the next 10 companies where the seller has a Manager+ connection, and on demand (Actions → Research
accounts → Run workflow, with a company count). `scripts/research-accounts.ts` runs the same agent as
`/research/` (`worker/research.ts`), in Node:

- **Queue:** companies never researched first, most connections first, then the least recently
  attempted. Companies researched successfully in the last 7 days are skipped.
- **Saving:** each run is recorded in `research_runs`. A run that finishes (or uses all its turns)
  replaces the company's signals, with their quotes; one cut short by the model or a service keeps the
  earlier signals. The ranked accounts score from these signals.
- **Pacing:** Massive limits calls per minute by plan, so a 429 is retried after a pause and companies
  are 20 seconds apart.

It needs the repository secrets `NVIDIA_API_KEY`, `MASSIVE_API_KEY` and `SEC_USER_AGENT`, plus the
Supabase ones to save. The model and API base URLs come from `wrangler.jsonc`. Only `main` saves;
pushes to other branches research CL as a dry run. The repository is public, so its Actions logs are
too: they show only public filing data, never connections.

### LinkedIn import

The Accounts page imports the seller's `Connections.csv` (LinkedIn: Settings → Data privacy → Get a copy
of your data → Connections). LinkedIn has no API for a member's connections, so the export is the only
source. The browser reads the file (`src/shared/connections.ts`), keeps Manager+ connections by title
(Manager, Director, VP, C-Suite, Owner/Partner), and matches their companies to the S&P 1500:

- by common name or SEC name, ignoring case, punctuation, accents and suffixes ("The Walt Disney
  Company" = "WALT DISNEY CO");
- by well-known brands and subsidiaries ("NBCUniversal" → Comcast, "ESPN" → Disney, "AWS" → Amazon),
  matched exactly;
- by a company name followed only by unit or region words ("Verizon Business", "Salesforce Japan"),
  so "Universal Music Group" isn't Universal Corp.

It shows a preview (matched companies with the names people listed, and the most common companies that
aren't in the S&P 1500) before saving. Only matched connections are sent (`POST /api/connections`, in
batches), with name, title, seniority, company as listed and date connected; emails and profile links
stay in the browser. Each import replaces the previous one.

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

## Roadmap

In build order:

1. **S&P Composite 1500 universe** (done): index membership, GICS sector, SEC CIK and revenue for each
   company, refreshed weekly by GitHub Actions.
2. **LinkedIn import** (done): upload `Connections.csv` on the Accounts page; Manager+ connections are
   matched to the S&P 1500.
3. **Saved research** (done): the research agent runs on matched companies every 6 hours, 10 at a
   time, in GitHub Actions, and saves signals and quotes to Supabase.
4. **Daily monitor:** a scheduled job (Cloudflare Cron Triggers) checks each matched company on EDGAR
   for new 8-Ks, Form 3s, 10-Qs and 10-Ks. Only companies with something new go to the research agent,
   in an update mode that adds new signals and retires outdated ones. Scores are recalculated daily
   from saved signals, so the 12-month window stays current. When an account moves up a tier or gains
   a strong new trigger, the agent writes a short "what changed and why it matters" alert.
5. **Apollo contacts** (coming in a future update; marked "Coming soon" on the site): search the role
   ladder for the top 50–100 accounts, and enrich emails only after seller approval, within credits.
   Needs an Apollo plan with API access to people search. The approval flow and its database
   constraints are already built and work on sample data.

Scoped for a future version: AI team benchmarks and peer comparisons (these need paid data).
