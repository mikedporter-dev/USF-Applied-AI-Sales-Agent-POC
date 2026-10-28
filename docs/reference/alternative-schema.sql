-- REFERENCE ONLY. DO NOT RUN. This is not a migration.
--
-- An alternative schema drafted in another session (branch
-- claude/festive-dirac-w0oj5s, commit c9fd4f6, since deleted). It conflicts
-- with supabase/migrations/0001_init.sql and 0002_target_contact_approval.sql.
--
-- Kept for the ingestion work. Parts to bring over as new migrations:
--   filings + filing_sections, signals.evidence_quote with filing/section links,
--   company_aliases, raw LinkedIn columns and match_method/confidence on
--   connections, apollo_person_id / enriched_at / credits_used on target_contacts.
-- Parts not to copy: target_contacts keyed per scoring run (would re-approve and
-- re-query Apollo every run), and its weaker approval check (0002 is stricter).

-- BD Agent POC: initial schema
--
-- Pipeline this supports:
--   1. Load the seller's first-degree LinkedIn connections (Manager level and above).
--   2. Match them against the S&P Composite 1500 (companies, linked by SEC CIK).
--   3. Pull trailing-12-month SEC data (Massive first, EDGAR for gaps) into filings/sections.
--   4. Extract Fit / Intent / Gap / demotion signals and score each matched company.
--   5. Rank into tiers; pick one Apollo target contact per top account.
--   6. Seller approves the list; only then enrich emails, within available credits.
--
-- Security: RLS is enabled on every table with no policies, so the anon and
-- authenticated keys can read nothing. The agent's backend uses the
-- service_role key, which bypasses RLS. Add policies before exposing any
-- table to a browser client.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type sp_index as enum ('sp500', 'sp400', 'sp600');

create type data_source as enum ('massive', 'edgar', 'apollo', 'linkedin', 'manual');

create type filing_form as enum ('10-K', '10-Q', '8-K', '3');

create type filing_section_kind as enum (
  'business',               -- 10-K Item 1
  'risk_factors',           -- 10-K Item 1A
  'mdna',                   -- 10-K Item 7 / 10-Q Item 2
  'earnings_release',       -- 8-K exhibit (usually EX-99.1)
  'investor_presentation',  -- 8-K exhibit
  'other'
);

create type score_dimension as enum ('fit', 'intent', 'gap', 'demotion');

create type signal_kind as enum (
  -- fit
  'company_size',
  'industry',
  -- intent
  'ai_commitment',          -- concrete AI investment, program, or stated ambition
  'leadership_change',      -- 8-K Item 5.02, new officer
  'new_officer_form3',      -- Form 3 filed by a newly appointed insider
  'acquisition',            -- 8-K Item 2.01 / 1.01
  'restructuring',          -- 8-K Item 2.05
  'ai_driven_reorg',
  -- gap
  'pilot_without_results',
  -- demotion
  'scaled_ai_results'       -- already publishing large-scale AI results
);

create type run_status as enum ('running', 'succeeded', 'failed');

create type approval_status as enum ('pending', 'approved', 'rejected');

create type email_status as enum ('not_requested', 'verified', 'guessed', 'unavailable', 'failed');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Companies (S&P Composite 1500 universe)
-- ---------------------------------------------------------------------------

create table public.companies (
  id               bigint generated always as identity primary key,
  cik              text not null unique check (cik ~ '^[0-9]{10}$'),  -- zero-padded, links Massive and EDGAR
  ticker           text not null,
  name             text not null,
  sp_index         sp_index not null,
  sector           text,
  industry         text,
  sic_code         text,
  employees        integer,
  market_cap_usd   numeric(20, 2),
  revenue_usd      numeric(20, 2),
  website_domain   text,                                              -- used for Apollo lookups
  hq_country       text,
  hq_state         text,
  size_source      data_source,
  data_refreshed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index companies_ticker_idx on public.companies (ticker);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- Alternate names used when matching LinkedIn "Company" text (e.g. "Google" -> Alphabet).
create table public.company_aliases (
  id          bigint generated always as identity primary key,
  company_id  bigint not null references public.companies (id) on delete cascade,
  alias       text not null,
  created_at  timestamptz not null default now()
);

create unique index company_aliases_alias_idx on public.company_aliases (lower(alias));
create index company_aliases_company_idx on public.company_aliases (company_id);

-- ---------------------------------------------------------------------------
-- Seller's LinkedIn network
-- ---------------------------------------------------------------------------

create table public.connections (
  id                bigint generated always as identity primary key,
  first_name        text not null,
  last_name         text not null,
  linkedin_url      text unique,
  email             text,                     -- only present if the connection shares it
  company_raw       text,                     -- "Company" column from the LinkedIn export
  position          text,
  connected_on      date,
  seniority         text,                     -- e.g. manager, director, vp, c_suite
  is_manager_plus   boolean not null default false,
  company_id        bigint references public.companies (id) on delete set null,
  match_method      text check (match_method in ('exact', 'alias', 'fuzzy', 'manual')),
  match_confidence  numeric(4, 3) check (match_confidence between 0 and 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index connections_company_idx on public.connections (company_id) where is_manager_plus;

create trigger connections_set_updated_at
  before update on public.connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- SEC filings (trailing 12 months)
-- ---------------------------------------------------------------------------

create table public.filings (
  id                bigint generated always as identity primary key,
  company_id        bigint not null references public.companies (id) on delete cascade,
  accession_number  text not null unique,     -- e.g. 0000320193-25-000073
  form              filing_form not null,
  filed_at          date not null,
  period_of_report  date,
  items_8k          text[],                   -- e.g. {5.02,2.05}; null for other forms
  source            data_source not null check (source in ('massive', 'edgar')),
  url               text,
  storage_path      text,                     -- raw document in object storage, if cached
  fetched_at        timestamptz not null default now()
);

create index filings_company_filed_idx on public.filings (company_id, filed_at desc);
create index filings_form_idx on public.filings (form, filed_at desc);

create table public.filing_sections (
  id          bigint generated always as identity primary key,
  filing_id   bigint not null references public.filings (id) on delete cascade,
  kind        filing_section_kind not null,
  exhibit     text,                           -- e.g. EX-99.1 for 8-K exhibits
  source      data_source not null check (source in ('massive', 'edgar')),
  content     text not null,
  char_count  integer generated always as (char_length(content)) stored,
  created_at  timestamptz not null default now(),
  unique (filing_id, kind, exhibit)
);

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------

create table public.scoring_runs (
  id           bigint generated always as identity primary key,
  status       run_status not null default 'running',
  window_start date not null,                 -- start of the trailing-12-month window
  window_end   date not null,
  model        text,                          -- LLM used for signal extraction
  params       jsonb not null default '{}',   -- weights, tier cutoffs, etc.
  notes        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  check (window_end > window_start)
);

-- Evidence behind each score: one row per extracted signal.
create table public.signals (
  id              bigint generated always as identity primary key,
  run_id          bigint not null references public.scoring_runs (id) on delete cascade,
  company_id      bigint not null references public.companies (id) on delete cascade,
  filing_id       bigint references public.filings (id) on delete set null,
  section_id      bigint references public.filing_sections (id) on delete set null,
  dimension       score_dimension not null,
  kind            signal_kind not null,
  summary         text not null,              -- one-line, seller-readable
  evidence_quote  text,                       -- verbatim excerpt from the filing
  event_date      date,                       -- when it happened; drives "why now"
  strength        numeric(4, 3) not null default 0.5 check (strength between 0 and 1),
  created_at      timestamptz not null default now()
);

create index signals_run_company_idx on public.signals (run_id, company_id);

create table public.company_scores (
  id           bigint generated always as identity primary key,
  run_id       bigint not null references public.scoring_runs (id) on delete cascade,
  company_id   bigint not null references public.companies (id) on delete cascade,
  fit_score    numeric(5, 2) not null check (fit_score between 0 and 100),
  intent_score numeric(5, 2) not null check (intent_score between 0 and 100),
  gap_score    numeric(5, 2) not null check (gap_score between 0 and 100),
  demotion     numeric(5, 2) not null default 0 check (demotion between 0 and 100),
  total_score  numeric(6, 2) not null,
  tier         smallint check (tier between 1 and 3),   -- null = not ranked
  rank         integer check (rank > 0),
  why_ranks    text,                          -- explanation of the score
  why_now      text,                          -- most recent trigger(s)
  created_at   timestamptz not null default now(),
  unique (run_id, company_id),
  unique (run_id, rank)
);

create index company_scores_run_rank_idx on public.company_scores (run_id, rank);

-- ---------------------------------------------------------------------------
-- Apollo target contacts (one per top account per run)
-- ---------------------------------------------------------------------------

create table public.target_contacts (
  id                bigint generated always as identity primary key,
  run_id            bigint not null references public.scoring_runs (id) on delete cascade,
  company_id        bigint not null references public.companies (id) on delete cascade,
  apollo_person_id  text,
  first_name        text,
  last_name         text,
  title             text,
  -- 1 Chief AI Officer / Head of AI, 2 Chief Data / D&A Officer,
  -- 3 CIO / CTO, 4 Chief Digital / Transformation Officer
  title_priority    smallint check (title_priority between 1 and 4),
  linkedin_url      text,
  approval          approval_status not null default 'pending',
  approved_at       timestamptz,
  email             text,                     -- populated only after approval + enrichment
  email_status      email_status not null default 'not_requested',
  enriched_at       timestamptz,
  credits_used      integer not null default 0 check (credits_used >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (run_id, company_id),
  -- Never hold an enriched email for a contact the seller has not approved.
  check (email is null or approval = 'approved')
);

create index target_contacts_approval_idx on public.target_contacts (run_id, approval);

create trigger target_contacts_set_updated_at
  before update on public.target_contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Output: one row per ranked account with why, why now, warm intros, target
-- ---------------------------------------------------------------------------

create view public.account_briefs
with (security_invoker = true) as
select
  s.run_id,
  s.rank,
  s.tier,
  c.id          as company_id,
  c.name        as company,
  c.ticker,
  c.cik,
  c.sector,
  c.industry,
  s.total_score,
  s.fit_score,
  s.intent_score,
  s.gap_score,
  s.demotion,
  s.why_ranks,
  s.why_now,
  coalesce(intros.warm_intros, '[]'::jsonb) as warm_intros,
  t.first_name || ' ' || t.last_name as target_name,
  t.title       as target_title,
  t.linkedin_url as target_linkedin,
  t.approval    as target_approval,
  t.email       as target_email,
  t.email_status as target_email_status
from public.company_scores s
join public.companies c on c.id = s.company_id
left join public.target_contacts t
  on t.run_id = s.run_id and t.company_id = s.company_id
left join lateral (
  select jsonb_agg(
           jsonb_build_object(
             'name', cn.first_name || ' ' || cn.last_name,
             'position', cn.position,
             'linkedin_url', cn.linkedin_url
           )
           order by cn.connected_on
         ) as warm_intros
  from public.connections cn
  where cn.company_id = s.company_id
    and cn.is_manager_plus
) intros on true
where s.tier is not null;

-- ---------------------------------------------------------------------------
-- Row level security: deny by default (service_role bypasses)
-- ---------------------------------------------------------------------------

alter table public.companies       enable row level security;
alter table public.company_aliases enable row level security;
alter table public.connections     enable row level security;
alter table public.filings         enable row level security;
alter table public.filing_sections enable row level security;
alter table public.scoring_runs    enable row level security;
alter table public.signals         enable row level security;
alter table public.company_scores  enable row level security;
alter table public.target_contacts enable row level security;
