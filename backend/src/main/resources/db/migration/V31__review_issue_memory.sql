-- Review Issue Memory — persistent repeated-VOC issues, their evidence, and their lifecycle.
--
-- WHY THIS EXISTS. `ProductIssues.tsx` today recomputes 이슈 후보 from whatever the inbox feed
-- happens to hold at page load. Nothing persists, so no question about CHANGE can be asked: an
-- issue has no identity across time, so "새로 나타남 / 증가 중 / 계속 발생" are unanswerable and
-- "개선됐다" is unprovable. This schema gives an issue an identity that outlives one page load.
--
-- ============================================================================================
-- VERSION NUMBERING
-- This file is V31 — the next free version above everything already on main. History: it was
-- authored as V29 while `feat/naver-initial-review-import` (V27/V28) was still an unmerged branch;
-- that branch has since merged, and V29/V30 were then taken by other merged work
-- (V30 = account_session_slot). Flyway `out-of-order` is NOT enabled (application.yml sets only
-- `enabled` + `baseline-on-migrate`), so a version below main's current max would fail the boot on
-- any database that has already migrated past it. V31 is strictly greater than main's max, so it is
-- a clean forward migration on both a fresh database and an already-migrated one.
-- ============================================================================================

-- One issue = one thing customers repeatedly say. Identity is the extractor's signature key, so
-- the same complaint arriving next month attaches to the SAME row rather than minting a new one.
create table review_issues (
    id                 uuid primary key,
    org_id             uuid        not null references organizations (id),
    -- Deterministic key derived from (aspect, problem). The unique index below makes this the
    -- issue's identity, which is what turns "search issue memory" into an indexed lookup rather
    -- than a similarity search — no vector extension, no external call.
    signature_key      varchar(64) not null,
    -- Operator-facing label. Derived from the signature vocabulary, never from customer text:
    -- a title assembled out of a review body would put raw content on every surface that lists
    -- issues, including ones that are only supposed to show counts.
    title              varchar(120) not null,
    aspect             varchar(40) not null,
    problem            varchar(40) not null,
    -- Fixed property of the problem vocabulary, NOT a judgment about any one review and NOT
    -- derived from rating. Rating-derived severity is precisely the current analyzer's known
    -- weakness (see contracts/review-eval/naver/v1/RUBRIC.md §6).
    severity           varchar(16) not null,
    -- OBSERVING / NEEDS_REVIEW / ACTING / VERIFYING / RESOLVED
    lifecycle_state    varchar(24) not null,
    -- Provenance, so a surface can tell WHICH extractor produced an issue. A future LLM adapter
    -- emits finer signatures and therefore different keys; its issues coexist with these rather
    -- than silently redefining them.
    extractor_kind     varchar(24) not null,
    extractor_version  varchar(32) not null,
    -- Maintained from evidence, not from wall-clock: first/last evidence dates drive the NEW
    -- judgement ("no evidence before the window") without a scan.
    first_evidence_on  date,
    last_evidence_on   date,
    -- Operator said 중요하지 않음. Kept rather than deleted so it cannot re-surface as new.
    dismissed          boolean     not null default false,
    created_at         timestamptz not null,
    updated_at         timestamptz not null
);
-- The issue-memory lookup, and the reason re-running extraction is idempotent.
create unique index uq_review_issues_signature on review_issues (org_id, signature_key);
create index idx_review_issues_org_state on review_issues (org_id, lifecycle_state);

-- One opinion unit of one review, attached to one issue. The grain is the UNIT, not the review:
-- "예쁜데 배송이 너무 늦었어요" is one review carrying one actionable unit, and a review that
-- complains about two different things must be able to be evidence for two issues.
create table review_issue_evidence (
    id               uuid        primary key,
    org_id           uuid        not null references organizations (id),
    issue_id         uuid        not null references review_issues (id),
    review_id        uuid        not null references reviews (id),
    -- Which opinion unit within the review (0-based, in reading order).
    unit_ordinal     integer     not null,
    -- Denormalized from the review so concentration aggregation is one indexed scan. Nullable
    -- because reviews.product_id is nullable.
    product_id       uuid        references products (id),
    -- The UTC date bucket of reviews.received_at, stored explicitly so every window is date
    -- arithmetic with no timezone ambiguity at query time. For file-imported rows this IS the
    -- calendar date the channel displayed (DateParse discards the time component and pins UTC
    -- midnight). See contracts/review-issue/v1/THRESHOLDS.md §1.
    occurred_on      date        not null,
    -- How this unit reached this issue. Only EXACT_SIGNATURE exists while the extractor is
    -- deterministic; the column exists so a future similarity match cannot be mistaken for one.
    match_confidence varchar(24) not null,
    created_at       timestamptz not null,
    updated_at       timestamptz not null
);
-- Re-running extraction over an already-processed review must not double-count its evidence.
create unique index uq_review_issue_evidence
    on review_issue_evidence (org_id, issue_id, review_id, unit_ordinal);
-- The window rollup: every temporal judgement is (issue, date range).
create index idx_review_issue_evidence_window
    on review_issue_evidence (org_id, issue_id, occurred_on);
-- The concentration rollup: (issue, product) shares within a window.
create index idx_review_issue_evidence_product
    on review_issue_evidence (org_id, issue_id, product_id);

-- NOTE ON WHAT IS DELIBERATELY ABSENT: there is no quote/body column here.
-- 대표 고객 표현 is rendered through the EXISTING masking path from review_id + unit_ordinal at
-- read time, exactly as ProductIssues.tsx already renders only the pre-masked FeedItem.snippet.
-- Copying the unit's text into this table would create a second store of customer content whose
-- masking is a matter of remembering to apply it, and it would leak into any surface that joins
-- this table for counts alone.

-- Opinion units that produced no usable signature. This is the UNKNOWN holding pen from the
-- pipeline design — the honest destination for "we could not tell", instead of the nearest issue.
-- Phase A WRITES here and reports the count; it does NOT cluster. Clustering needs semantic
-- capability that scope lock v1.6 ② has not opened.
create table review_issue_unknown_units (
    id            uuid        primary key,
    org_id        uuid        not null references organizations (id),
    review_id     uuid        not null references reviews (id),
    unit_ordinal  integer     not null,
    product_id    uuid        references products (id),
    occurred_on   date        not null,
    -- NO_SIGNATURE (no aspect/problem recognised) | NO_PROBLEM (aspect only) | NO_ASPECT
    reason        varchar(32) not null,
    created_at    timestamptz not null,
    updated_at    timestamptz not null
);
create unique index uq_review_issue_unknown_units
    on review_issue_unknown_units (org_id, review_id, unit_ordinal);
create index idx_review_issue_unknown_units_window
    on review_issue_unknown_units (org_id, occurred_on);

-- Lifecycle audit. Separate from the issue row because the operator's 조치 기록 is the thing that
-- makes 개선 확인 중 → 해결됨 legitimate, and an overwritten state loses it.
create table review_issue_state_events (
    id           uuid        primary key,
    org_id       uuid        not null references organizations (id),
    issue_id     uuid        not null references review_issues (id),
    -- Null only for the row that records the issue's creation.
    from_state   varchar(24),
    to_state     varchar(24) not null,
    -- SYSTEM | OPERATOR. Load-bearing: only two transitions may be SYSTEM
    -- (OBSERVING→NEEDS_REVIEW on a firing judgement, VERIFYING→RESOLVED on quiet weeks).
    actor        varchar(16) not null,
    -- What caused it: NEW | SURGING | PERSISTENT | CONCENTRATED | QUIET_WEEKS | OPERATOR | REOPENED
    reason       varchar(32) not null,
    -- The operator's own note (조치 내용). Operator-authored, not customer content.
    note         text,
    created_at   timestamptz not null,
    updated_at   timestamptz not null
);
create index idx_review_issue_state_events_issue
    on review_issue_state_events (org_id, issue_id, created_at);
