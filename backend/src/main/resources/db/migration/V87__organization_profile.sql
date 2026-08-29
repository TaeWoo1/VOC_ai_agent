-- Seller Context v1-B — who this company is, in the seller's own words, once per org.
--
-- One nullable text and nothing else. This is deliberately NOT a column on organization_answer_style
-- (which says HOW a reply is worded) and NOT a row in org_knowledge_sources (which says WHAT is true
-- about shipping, refunds, specs — and is searched, chunked and cited). A business summary is neither:
-- it is context about the company, it is never evidence for an operational claim, and it is never
-- indexed for retrieval. Keeping it in its own table is what keeps those three things from blurring.
--
-- Absence is the normal state. No backfill, nothing created on signup; a row appears when a seller
-- saves the 회사 정보 screen. Nothing in the backend writes this row except that screen's service —
-- SellerProfileFenceTest names the packages that may not.
create table organization_profile (
    org_id           uuid primary key references organizations (id),

    -- The seller's description of the company and its business, capped at 500 characters at write
    -- time. Treated as DATA everywhere downstream: quoted on a labelled line of a user turn, never
    -- concatenated into a system turn, never parsed for facts.
    business_summary text,

    updated_at       timestamptz not null,
    updated_by       uuid,
    created_at       timestamptz not null default now()
);
