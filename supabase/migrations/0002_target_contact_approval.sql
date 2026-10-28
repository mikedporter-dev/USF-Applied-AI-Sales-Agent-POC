-- Seller approval gates email enrichment. Run after 0001_init.sql.
--
-- 0001 already added target_contacts.approved_at; this migration reuses it as
-- the approval timestamp and adds an explicit status next to it.
--
-- The check constraints apply to every writer, including the Worker's
-- service-role key (RLS is bypassed by that key; constraints are not). So a
-- bug can't store an email, or record an enrichment attempt, for a contact
-- the seller hasn't approved.

begin;

create type approval_status as enum ('pending', 'approved', 'rejected');

alter table target_contacts
  add column approval_status approval_status not null default 'pending';

-- Rows approved under 0001 (approved_at set) keep their approval.
update target_contacts
   set approval_status = 'approved'
 where approved_at is not null;

alter table target_contacts
  -- approved_at is set exactly when the contact is approved.
  add constraint target_contacts_approved_at_matches_status
    check ((approval_status = 'approved') = (approved_at is not null)),

  -- Any enrichment result (an email, 'enriched', or 'unavailable', which means
  -- Apollo was already asked) requires approval. If this fails while migrating,
  -- some existing row was enriched without approval: review it before retrying.
  add constraint target_contacts_enrichment_requires_approval
    check (approval_status = 'approved' or (email is null and email_status = 'not_enriched'));

create index target_contacts_approval_status on target_contacts (approval_status);

commit;
