-- Inquiry operational lifecycle + the source-observation primitive.
--
-- WHY THIS EXISTS. A seller dismissed 3,199 Cafe24 board-6 spam posts through the approved
-- dismissal batches on 2026-07-06 (inquiry_work_item.phase=DISMISSED, disposition=SPAM). That
-- decision was recorded on the WORK ITEM and nowhere else, and every current-truth consumer reads
-- `inquiries` directly -- so the home screen, the inbox, product signals, repeat analysis and the
-- Operator all still counted them. 3,200 of this org's 3,216 "미답변" rows were work the seller had
-- already decided not to do.
--
-- `operational_state` is a PROJECTION of that decision, not a second place to make it. The
-- disposition on the work item stays the only authority; this column exists so a count can be a
-- count instead of a five-table join, and so the projection can be rebuilt from the ledger at any
-- time (InquiryOperationalStateProjector / -Backfill).
--
-- `last_seen_at` is the primitive that does not exist anywhere in this system today: "the source
-- still showed us this row on this run". The inquiry upsert skips the save entirely when nothing
-- changed, and the community-article upsert skips it too, so an unchanged row is currently
-- indistinguishable from a deleted one. No absence-based reconciliation can be built until that
-- distinction is recorded -- and none is enabled here (see InquiryOperationalState.SOURCE_REMOVED).

alter table inquiries add column if not exists operational_state varchar(24) not null default 'ACTIVE';
alter table inquiries add column if not exists operational_state_at timestamptz;
alter table inquiries add column if not exists last_seen_at timestamptz;

-- The two shapes every current-truth read now has: "active + status" (counts) and
-- "active + newest first" (feeds). Both are org-scoped because org_id is the tenant boundary.
create index if not exists idx_inquiries_org_state_status
    on inquiries (org_id, operational_state, status);
create index if not exists idx_inquiries_org_state_received
    on inquiries (org_id, operational_state, received_at desc);

-- Existing rows are ACTIVE by the column default. The seller-approved SPAM exclusion is applied by
-- the idempotent backfill (POST /api/inquiries/operational-state/backfill), NOT here: the batch
-- ledger it reads lives in the application's own vocabulary, and a migration that hard-codes a
-- disposition would become a second authority the moment that vocabulary grows.
