-- Saved research. scripts/research-accounts.ts runs the research agent on the
-- companies where the seller has connections and saves what it found. Each run
-- is recorded; a successful run replaces the company's signals, so they always
-- come from one 12-month read of the filings.

begin;

create table research_runs (
  id           bigint generated always as identity primary key,
  cik          char(10) not null references companies (cik) on delete cascade,
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  -- finished, step_limit, model_error or error
  stop_reason  text not null,
  summary      text,
  signal_count integer not null default 0,
  model        text,
  error        text
);
create index research_runs_cik_finished on research_runs (cik, finished_at desc);
alter table research_runs enable row level security;

-- The quote each signal was recorded with, and the run that found it.
alter table signals add column quote text;
alter table signals add column research_run_id bigint references research_runs (id) on delete cascade;

commit;
