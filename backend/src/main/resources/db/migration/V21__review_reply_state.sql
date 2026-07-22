-- Review reply state: what the CHANNEL says about whether the seller already answered.
--
-- The NAVER review export states this per row (답글여부 Y/N, plus 답글등록일시), and the
-- pipeline dropped both — no alias, no canonical field, no column. The cost was measured on a
-- real export: 33% of the low-rating rows (26 of 79) were already answered, so the operator's
-- "확인이 필요한 리뷰" queue was inflated by a third and the guided-reply flow could walk a
-- seller to the reply box for a review they had already answered — a duplicate PUBLIC reply.
--
-- Additive only (no drops). IF NOT EXISTS keeps re-runs / partial-applies safe, matching V8/V18.
--
-- reply_state is the CHANNEL's statement, not SellerOps' own record of a guided reply. Those are
-- different facts and stay in different places: a reply SellerOps guided is recorded in
-- review_reply_outcome as OPERATOR_REPORTED_SUBMITTED + UNVERIFIED, because no read-back oracle
-- exists. This column only ever mirrors what an import said.
--
-- Default UNKNOWN, deliberately, and NOT NULL:
--   * Every row that predates this migration genuinely has no known state — UNKNOWN says so.
--   * UNKNOWN keeps counting as "needs a look" on the attention surface, so no historical row
--     silently drops out of a queue on the day this ships. Only an explicit ANSWERED excludes.
--   * There is nothing to backfill FROM: the state lives in the export, so it arrives with the
--     next import, not from a data migration.
-- Values are the names of com.sellerops.review.ReviewReplyState (PENDING | ANSWERED | UNKNOWN),
-- deliberately a subset of the Cafe24-side CommunityReplyStatus vocabulary so both sources land
-- on the same operator-facing chip.
alter table reviews add column if not exists reply_state varchar(16) not null default 'UNKNOWN';

-- When the channel says the reply was posted. Date-granular in practice: the export's
-- 답글등록일시 carries a time, but the shared DateParse path quantises to UTC start-of-day, and
-- this value is diagnostic only — nothing gates on it.
alter table reviews add column if not exists replied_at timestamptz;

-- No index in this slice. The attention counts already ride idx_reviews_org_received for the
-- window scan and add reply_state only as a residual predicate; an index chosen before a measured
-- need would be speculative.
