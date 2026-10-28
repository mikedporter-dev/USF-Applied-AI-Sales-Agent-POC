-- Schema for the sales agent POC. Mirrors src/shared/types.ts.
-- The Worker reads with the service-role key; RLS is enabled with no policies,
-- so the anon key cannot read anything.

create type index_membership as enum ('S&P 500', 'S&P MidCap 400', 'S&P SmallCap 600');
create type signal_kind as enum (
  'ai_commitment', 'leadership_change', 'acquisition', 'restructuring',
  'ai_reorg', 'ai_pilot_no_results', 'ai_scaled_results'
);
create type filing_form as enum ('10-K', '10-Q', '8-K', '8-K EX-99', 'Form 3');
create type signal_source as enum ('massive', 'edgar');
create type seniority as enum ('Manager', 'Director', 'VP', 'C-Suite', 'Owner/Partner');
create type email_status as enum ('not_enriched', 'enriched', 'unavailable');

-- S&P Composite 1500 universe. CIK joins Massive and SEC EDGAR data.
create table companies (
  cik              char(10) primary key,
  ticker           text not null,
  name             text not null,
  industry         text not null,          -- GICS sector
  index_membership index_membership not null,
  revenue_usd      numeric not null,
  employees        integer not null,
  updated_at       timestamptz not null default now()
);

-- Evidence extracted from filings (by the LLM, from Massive and EDGAR text).
create table signals (
  id         bigint generated always as identity primary key,
  cik        char(10) not null references companies (cik) on delete cascade,
  kind       signal_kind not null,
  summary    text not null,
  form       filing_form not null,
  section    text,
  filed_at   date not null,
  source     signal_source not null,
  url        text,
  created_at timestamptz not null default now()
);
create index signals_cik_filed_at on signals (cik, filed_at desc);

-- Seller's first-degree LinkedIn connections, Manager level or above, matched to a company.
create table connections (
  id           bigint generated always as identity primary key,
  cik          char(10) not null references companies (cik) on delete cascade,
  name         text not null,
  title        text not null,
  seniority    seniority not null,
  connected_on date,
  created_at   timestamptz not null default now()
);
create index connections_cik on connections (cik);

-- One target contact per account from Apollo, found by walking the role ladder.
create table target_contacts (
  id            bigint generated always as identity primary key,
  cik           char(10) not null references companies (cik) on delete cascade,
  name          text not null,
  title         text not null,
  ladder_rank   smallint not null check (ladder_rank between 0 and 3),
  email_status  email_status not null default 'not_enriched',
  email         text,
  approved_at   timestamptz,               -- seller approval gates email enrichment
  created_at    timestamptz not null default now()
);
create index target_contacts_cik on target_contacts (cik);

alter table companies       enable row level security;
alter table signals         enable row level security;
alter table connections     enable row level security;
alter table target_contacts enable row level security;
