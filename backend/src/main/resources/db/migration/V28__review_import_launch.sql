-- NAVER Initial Review Import (V1): single-use launch tickets for the guided Action Window.
--
-- V27 gave the import a plan/segment/attempt record, but assumed the operator would hand SellerOps a
-- file they had already exported and located themselves. The real product flow is a guided Action
-- Window: the seller clicks one button, the local agent opens the seller center, a tutorial guides the
-- seller through the required range, and the resulting download is detected and ingested automatically.
--
-- That flow needs something V27 has no place for: a **binding** the local-agent runtime can carry.
-- The Action Window contract deliberately refuses to transport a plan id, a segment id, or a date
-- (contracts/action-window/v2 — a run carries only opaque 16-hex refs), so the runtime cannot be told
-- "import segment <uuid>, dates <x>..<y>" over the wire. Instead the frontend mints a ticket here, the
-- runtime receives only its opaque `launch_ref`, and the server resolves that ref back to the seller
-- account, plan, segment, and required dates. One row is therefore the whole authorization for one
-- guided run — which is also what makes it safe to make it SINGLE USE.
--
-- Additive only (no drops). IF NOT EXISTS keeps re-runs / partial-applies safe, matching V27.

-- 1) review_import_launch — one authorized guided run.
--
--    Two kinds, because the FIRST command of an onboarding import has no plan yet:
--      * DISCOVERY — find the historical range NAVER currently lets this seller reach. It has no
--        plan_id or segment_id when issued; recording its discovered range is what CREATES the plan
--        (plan_id is then backfilled, so the ticket keeps the provenance of the plan it produced).
--      * SEGMENT   — guide ONE already-planned segment to a downloaded, ingested file.
--
--    `range_evidence` / `scope_evidence` record HOW each fact was established, because the two ways are
--    not equally strong and the difference must never be flattened: MACHINE_* means SellerOps read the
--    value off the live seller-center controls itself; OPERATOR_CONFIRMED means it could not, and a human confirmed it
--    through the tutorial. An operator confirmation is never to be labelled machine-verified anywhere
--    it surfaces, so the distinction is stored, not inferred.
create table if not exists review_import_launch (
    id                uuid         primary key,
    org_id            uuid         not null references organizations (id),
    seller_account_id uuid         not null references seller_accounts (id),
    channel_id        uuid         not null references channels (id),
    -- The opaque 16-hex ref carried on the Action Window wire. Random, unguessable, and the ONLY
    -- identifier the runtime ever learns for this work.
    launch_ref        varchar(16)  not null,
    kind              varchar(16)  not null,                        -- DISCOVERY | SEGMENT
    -- DISCOVERY: null at issue, set to the plan it created. SEGMENT: always set.
    plan_id           uuid         references review_import_plan (id),
    segment_id        uuid         references review_import_segment (id),
    status            varchar(16)  not null default 'ISSUED',       -- ISSUED | CONSUMED | EXPIRED
    -- DISCOVERY outcome: the range NAVER actually allowed, and how we know it.
    discovered_start  date,
    discovered_end    date,
    range_evidence    varchar(24),                                  -- MACHINE_DISCOVERED | OPERATOR_CONFIRMED
    -- SEGMENT outcome: how we know the exported scope matched the segment.
    scope_evidence    varchar(24),                                  -- MACHINE_MATCHED | OPERATOR_CONFIRMED
    issued_at         timestamptz  not null,
    consumed_at       timestamptz,
    created_at        timestamptz  not null,
    updated_at        timestamptz  not null
);

-- The ref is the credential the runtime presents, so it must be globally unambiguous.
create unique index if not exists uq_review_import_launch_ref
    on review_import_launch (launch_ref);

-- At most ONE outstanding ticket per segment, and one outstanding DISCOVERY per seller account.
-- Partial (status = 'ISSUED') so consumed history accumulates freely — this constrains what is
-- currently authorized, not what has ever happened. It makes the seller re-clicking the button
-- idempotent at the DB level: the service hands back the existing ticket instead of minting a second
-- one that would let the same segment be ingested twice from two different runs.
create unique index if not exists uq_review_import_launch_open_segment
    on review_import_launch (segment_id)
    where status = 'ISSUED' and segment_id is not null;
create unique index if not exists uq_review_import_launch_open_discovery
    on review_import_launch (org_id, seller_account_id)
    where status = 'ISSUED' and kind = 'DISCOVERY';

create index if not exists idx_review_import_launch_account
    on review_import_launch (org_id, seller_account_id, issued_at desc);

-- 2) review_import_segment_attempt.scope_evidence — how THIS attempt's scope was established.
--
--    V27 recorded only the boolean `scope_confirmed`, which was truthful when the only path was an
--    operator ticking a box. Now a guided run may read the selected range back off the page, and
--    "SellerOps verified the dates" and "a human said the dates were right" are different claims with
--    different strength. Nullable: rows written before this column existed genuinely have no evidence
--    recorded, and back-filling them with either value would invent a fact.
alter table review_import_segment_attempt
    add column if not exists scope_evidence varchar(24);            -- MACHINE_MATCHED | OPERATOR_CONFIRMED
