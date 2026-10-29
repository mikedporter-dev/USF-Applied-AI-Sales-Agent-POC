---
name: prospect-brief
description: Research one public company as a prospect for AI transformation services and write a cited brief in the Inroad app's format (Fit, Intent and Gap scores, tier, why it ranks, why now, warm path, target contact), from its last 12 months of SEC filings. Use this whenever the user names a company or ticker and asks to research it, prospect it, size it up, check whether it's a good target or ready for AI services, find the why-now or trigger, find who to contact there, or turn it into an account for the app, even if they don't say "brief". Also use it to produce SQL that loads a researched account into Supabase. Not for editing the app's code or scoring rules.
---

# Prospect brief

Produce the same answer the Inroad app gives for an account, for one company the
seller names: how it ranks, why now, who in the seller's network can get them in,
and who they're trying to reach. Every claim must trace to a filing, because the
seller will use this in front of a real executive, and a wrong or invented fact
there costs them the meeting.

The app's rules live in this repo. Read them rather than relying on memory:
`src/shared/scoring.ts` (weights, tiers, demotion, contact ladder) and
`src/shared/types.ts` (the signal kinds and the account shape).

## What to ask for

You need the company (name or ticker). Also ask, once, for the seller's
first-degree connections there at Manager level or above (name and title),
because you can't see their LinkedIn network. If they don't know or skip it,
carry on and mark the warm path as not provided. Don't block on it.

## Workflow

### 1. Identify the company

Use the Massive connector (`search_endpoints`, then `call_api`) to get the
ticker, SEC CIK (zero-padded to 10 digits), revenue, employee count, and
industry. The CIK links Massive and SEC EDGAR data, so get it right.

- **Industry:** the scoring expects a GICS sector name, one of the keys of
  `INDUSTRY_FIT` in `scoring.ts`. If the source gives an SIC code or another
  scheme, map it to the closest GICS sector and say in the brief that you did.
- **S&P Composite 1500 membership** (S&P 500, MidCap 400 or SmallCap 600): the
  app's universe. Confirm it from a source; if you can't, say "unverified".
  Never guess it.

### 2. Gather 12 months of filings

The window is the 12 months ending today. Older filings don't count, even
striking ones; mention them only under caveats.

- **From Massive (primary):** the latest 10-K, Item 1 Business and Item 1A Risk
  Factors; 8-Ks for officer changes (Item 5.02), acquisitions (Item 2.01) and
  restructurings (Item 2.05); Form 3 filings by newly appointed insiders.
- **From SEC EDGAR (fills the gaps):** earnings releases and investor
  presentations filed as 8-K exhibits (usually EX-99.1), and MD&A (10-K Item 7,
  10-Q Item 2). The filing index is at
  `https://data.sec.gov/submissions/CIK<10-digit CIK>.json`; SEC asks for a
  User-Agent header with contact details. If EDGAR is unreachable from this
  session, say so and look for the same documents through Massive or
  Bigdata.com.
- **Bigdata.com (context only):** recent news can help explain a trigger, but
  the scores use SEC filings only, as the POC defines. Label any news as
  context, and refer to the service as "Bigdata.com" with a link to
  https://bigdata.com. Take a company's listing type from `find_securities`,
  not from memory.

Read the actual text. A press summary of a filing isn't a substitute for it.

### 3. Extract signals

Turn what you read into signals using the app's kinds. One signal per distinct
fact; don't split one announcement into several to inflate a score.

| Kind | Counts when the filing shows | Score |
|---|---|---|
| `ai_commitment` | A concrete AI investment, program, target or dated goal. Generic "we use AI" language doesn't count. | Intent |
| `leadership_change` | A new or departing officer (8-K Item 5.02, Form 3) | Intent |
| `acquisition` | A completed acquisition (8-K Item 2.01) | Intent |
| `restructuring` | A restructuring or reorganization (8-K Item 2.05, or disclosed elsewhere) | Intent |
| `ai_reorg` | A restructuring explicitly tied to AI | Intent |
| `ai_pilot_no_results` | An AI pilot or experiment with no reported outcome | Gap |
| `ai_scaled_results` | AI already running at scale with reported results. This demotes the account. | Demotion |

For each signal record: `kind`, a one-line `summary` the seller can read aloud,
`form` (`10-K`, `10-Q`, `8-K`, `8-K EX-99` or `Form 3`), `section`, `filedAt`
(YYYY-MM-DD, the filing date), `source` (`massive` or `edgar`), `url`, and a
short verbatim quote. The quote is what lets the seller check you.

### 4. Score with the app's code

Write the account as JSON in the `AccountInput` shape (`company`, `signals`,
`connections`) to a scratch file, then run:

```bash
node --experimental-strip-types --no-warnings .claude/skills/prospect-brief/scripts/score.mts <account.json>
```

It runs `src/shared/scoring.ts` itself, so the tier and scores match what the
app would show. Use its output for the scores, tier, reasons and why-now.
Don't adjust the numbers by hand; if a result looks wrong, the signals are
usually what needs another look. If `notInNetwork` is true, say clearly that
the app would skip this account until the seller has a Manager+ connection
there.

### 5. Find the target contact (Apollo search only)

Use Apollo's people search (`apollo_mixed_people_api_search`) for the company,
walking the ladder in `CONTACT_ROLE_LADDER` in order:

1. Chief AI Officer or Head of AI
2. Chief Data Officer or Chief Data & Analytics Officer
3. Chief Information Officer or Chief Technology Officer
4. Chief Digital Officer or Chief Transformation Officer

Stop at the first rung with a match and record name, title and ladder step.

Search only. Don't call any tool that enriches or reveals emails or phone
numbers (such as `apollo_people_match`, `apollo_people_bulk_match`,
`apollo_agent_bulk_enrich`), creates contacts, or touches sequences or email.
In this POC, enrichment happens only after the seller approves the list in the
app, and the database refuses an email for an unapproved contact. Enriching
here would spend credits on someone the seller hasn't approved. If an Apollo
response includes credit usage, tell the user.

### 6. Write the brief

Save it as `briefs/<TICKER>-<YYYY-MM-DD>.md`. `briefs/` is git-ignored because
briefs name real people; don't commit them. Use this structure:

```markdown
# <Company> (<TICKER>): Tier <n>, score <total>

As of <date> · CIK <cik> · <S&P index or "S&P 1500 membership unverified"> · <GICS sector> · <revenue> revenue

## Why it ranks
Fit <fit> · Intent <intent> · Gap <gap><, demoted: already reports scaled AI results>
- <reason, with citation (form, section, date)>

## Why now
<The latest trigger, with citation. Or: "No trigger in the last 12 months.">

## Who can get you in
<Connections provided, most senior first. Or: "Not provided. The app only scores accounts where you have a Manager+ connection.">

## Who you're trying to reach
<Name, title, ladder step n of 4.> Email not enriched: approve this contact in the app first.

## Evidence
| Signal | What the filing says | Filing | Date | Source |
|---|---|---|---|---|
| <kind label> | "<quote>" | <form · section> | <date> | <link> |

## Outreach angle
<One sentence on why now, two or three bullets on the gap between AI ambition and results, one sentence on using the warm introduction. Only from the evidence above.>

## Caveats
<What you couldn't verify, sources that were unreachable, industry mappings you made, notable filings outside the window.>
```

Then give the user a short summary in chat: tier, score, the why-now in one
line, the target contact, and the file path.

### 7. Supabase SQL (only when asked)

If the user wants the account in the app, write `briefs/<TICKER>-<YYYY-MM-DD>.sql`
for them to run in the Supabase SQL Editor. Don't run it yourself. Only write
it if S&P 1500 membership is confirmed, because `index_membership` is required
and the app's universe is the S&P 1500. Match the tables in
`supabase/migrations/`, and keep any approval the seller has already made:

```sql
begin;

insert into companies (cik, ticker, name, industry, index_membership, revenue_usd, employees)
values ('<cik>', '<ticker>', '<name>', '<GICS sector>', '<S&P 500|S&P MidCap 400|S&P SmallCap 600>', <revenue>, <employees>)
on conflict (cik) do update set
  ticker = excluded.ticker, name = excluded.name, industry = excluded.industry,
  index_membership = excluded.index_membership, revenue_usd = excluded.revenue_usd,
  employees = excluded.employees, updated_at = now();

-- Signals are regenerated from this research.
delete from signals where cik = '<cik>';
insert into signals (cik, kind, summary, form, section, filed_at, source, url) values
  ('<cik>', '<kind>', '<summary>', '<form>', '<section>', '<YYYY-MM-DD>', '<massive|edgar>', '<url>');

-- One row per connection the seller gave you, skipped if already there.
insert into connections (cik, name, title, seniority)
select '<cik>', '<name>', '<title>', '<Manager|Director|VP|C-Suite|Owner/Partner>'
where not exists (select 1 from connections where cik = '<cik>' and name = '<name>');

-- Added only if the account has no target contact yet, so an existing approval is kept.
-- New contacts start as pending, with no email.
insert into target_contacts (cik, name, title, ladder_rank)
select '<cik>', '<name>', '<title>', <ladder step - 1>
where not exists (select 1 from target_contacts where cik = '<cik>');

commit;
```

Escape single quotes in text by doubling them (`O''Brien`).

## Principles

- **Cite or leave it out.** If you can't point to the filing, it doesn't go in
  the brief. Saying "not found" is useful to the seller; a plausible guess is
  harmful.
- **Filings drive the score.** News and general knowledge can add context in
  the brief, but never become signals.
- **Don't spend what the seller hasn't approved.** Apollo search only.
- **Keep people's details out of git.** Briefs and SQL stay in `briefs/`.
