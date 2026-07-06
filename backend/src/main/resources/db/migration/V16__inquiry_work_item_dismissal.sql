-- Phase: audited bulk dismissal of inquiry work items (e.g. spam).
--
-- Additive schema ONLY. Adds the metadata for a new terminal work-item phase,
-- DISMISSED (an operator-approved set-aside that was never answered — deliberately
-- distinct from COMPLETED), plus a durable dismissal-batch ledger that makes every
-- bulk dismissal reproducible and idempotent.
--
--   * inquiry_work_item.disposition        — current dismissal reason (nullable);
--   * inquiry_work_item_dismissal_batch     — one row per executed bulk dismissal,
--       the idempotency + approval/execution evidence (unique per org+command);
--   * inquiry_work_item_audit.disposition   — the reason on the immutable event row;
--   * inquiry_work_item_audit.dismissal_batch_id — links each dismissal audit to the
--       batch that caused it, so the trail ties back to the approved manifest.
--
-- No data migration: this does NOT dismiss any existing row. The live 3,199
-- deleted-source spam inquiries stay OPEN until an explicit, approved manifest is
-- executed through InquiryWorkItemDismissalService. All existing phases, work items,
-- inquiries, and audit rows are preserved unchanged. The ledger holds NO inquiry
-- title/body/author or buyer PII — only ids, counts, a manifest hash, and the
-- approval/execution envelope. IF NOT EXISTS keeps re-runs/partial-applies safe.

alter table inquiry_work_item
    add column if not exists disposition varchar(32);

-- Durable dismissal-batch ledger. approved_by/approved_at are approval metadata (who
-- signed off); executed_by/executed_at are the authenticated executor + server time.
-- manifest_hash binds command_id to the exact approved payload (org, account,
-- disposition, sorted work-item ids, approval metadata). (org_id, command_id) is
-- UNIQUE so a command can execute at most once per org.
create table if not exists inquiry_work_item_dismissal_batch (
    id                 uuid         primary key,
    org_id             uuid         not null references organizations (id),
    seller_account_id  uuid         not null references seller_accounts (id),
    command_id         varchar(120) not null,
    disposition        varchar(32)  not null,
    manifest_hash      varchar(64)  not null,
    item_count         integer      not null,
    approved_by        varchar(200) not null,
    approved_at        timestamptz  not null,
    executed_by        varchar(120) not null,
    executed_at        timestamptz  not null,
    status             varchar(32)  not null,
    created_at         timestamptz  not null,
    updated_at         timestamptz  not null
);
create unique index if not exists uq_dismissal_batch_org_command
    on inquiry_work_item_dismissal_batch (org_id, command_id);

alter table inquiry_work_item_audit
    add column if not exists disposition varchar(32);

alter table inquiry_work_item_audit
    add column if not exists dismissal_batch_id uuid
        references inquiry_work_item_dismissal_batch (id);
