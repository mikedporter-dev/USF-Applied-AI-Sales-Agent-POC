-- S&P Composite 1500 import. The companies table becomes the universe: every
-- company in the three indexes, whether or not the seller knows anyone there.

begin;

-- Revenue comes from SEC XBRL and a few companies don't tag it; employee counts
-- come later, per company, from Massive.
alter table companies alter column revenue_usd drop not null;
alter table companies alter column employees drop not null;

alter table companies add column revenue_fiscal_year_end date;
alter table companies add column revenue_source text;

-- Each import stamps the rows it saw. Companies that drop out of the indexes are
-- kept (their signals and connections stay) but marked in_index = false.
alter table companies add column in_index boolean not null default true;
alter table companies add column indexed_at timestamptz;

create index companies_in_index on companies (in_index, index_membership);

commit;
