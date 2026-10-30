-- LinkedIn import. Companies get their SEC registrant name next to the common
-- name, since both help match the company names people use on LinkedIn.
-- Connections remember the company as the person listed it (e.g. "NBCUniversal"
-- under Comcast) and which import they came from, so a re-import replaces them.

begin;

alter table companies add column legal_name text;

alter table connections add column company_as_listed text;
alter table connections add column imported_at timestamptz;

commit;
