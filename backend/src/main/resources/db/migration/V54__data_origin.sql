-- Real seller data and manufactured data have been living in the same tables with nothing to tell
-- them apart, and the demo org's own screens were the proof: "미답변 9" was eight seeded rows and one
-- real inquiry; "부정 리뷰 25" included eleven strings about a product nobody sold. Arithmetically
-- correct, operationally worthless.
--
-- Not deleted. A demo org is also a test corpus, and the fixtures that proved Coupang's inquiry
-- ingestion end to end are evidence. They should stop being COUNTED, not stop existing — the same
-- shape as V51's operational_state, which kept 3,199 seller-dismissed inquiries and simply stopped
-- calling them work.

alter table reviews                add column if not exists data_origin varchar(20) not null default 'REAL';
alter table inquiries              add column if not exists data_origin varchar(20) not null default 'REAL';
alter table order_daily_summaries  add column if not exists data_origin varchar(20) not null default 'REAL';

-- ---------------------------------------------------------------------------------------------
-- One-time classification of rows written before this column existed.
--
-- Every rule below is structural, not textual, so it cannot drift as seed copy is edited, and each
-- was verified against the live demo DB on 2026-08-22 before being written down. On a database that
-- never ran the seeder these statements match nothing.
-- ---------------------------------------------------------------------------------------------

-- Reviews and inquiries: the ingest paths ALWAYS compute a content hash, and API paths also carry an
-- external id. A row with neither cannot have come from an ingest — only MockDataSeeder builds
-- entities by hand and saves them directly.
--
-- Verified: 44 reviews and 16 inquiries match, exactly the seeder's two loop counts (44 and 16). Two
-- independent signals agreeing on the same row set is what makes this safe to run unattended.
update reviews   set data_origin = 'DEMO_SEED'
    where external_id is null and content_hash is null and data_origin = 'REAL';
update inquiries set data_origin = 'DEMO_SEED'
    where external_id is null and content_hash is null and data_origin = 'REAL';

-- Live-verification fixtures: written by a proof run under a reserved external-id prefix so they
-- would be identifiable later. This is that later.
update inquiries set data_origin = 'VERIFY_FIXTURE'
    where external_id like 'VERIFY-%' and data_origin = 'REAL';
update reviews   set data_origin = 'VERIFY_FIXTURE'
    where external_id like 'VERIFY-%' and data_origin = 'REAL';

-- Order summaries carry no hash and no external id, so the discriminator is the seeder's own
-- arithmetic: sales_amount = order_count * (12900 + 3000 * channel_index). A seeded row therefore has
-- an exact integer unit price drawn from {12900, 15900, 18900, ...}; real daily takings essentially
-- never do, and on the demo DB 32 of 34 distinct NAVER unit prices are non-integer multiples.
--
-- Verified: matches 14 Coupang days at exactly 12,900 and 11 NAVER days at exactly 15,900 — the
-- seeder writes 14 per channel, and the 3 missing NAVER days were later overwritten by real syncs
-- through the natural-key upsert, which is precisely why a date-range rule would have been wrong.
update order_daily_summaries set data_origin = 'DEMO_SEED'
    where data_origin = 'REAL'
      and order_count > 0
      and sales_amount % order_count = 0
      and (sales_amount / order_count) >= 12900
      and ((sales_amount / order_count) - 12900) % 3000 = 0;

create index if not exists idx_reviews_org_origin   on reviews (org_id, data_origin);
create index if not exists idx_inquiries_org_origin on inquiries (org_id, data_origin);

comment on column reviews.data_origin is
    'REAL | DEMO_SEED | VERIFY_FIXTURE — see com.sellerops.common.DataOrigin. Default reads exclude non-REAL.';
comment on column inquiries.data_origin is
    'REAL | DEMO_SEED | VERIFY_FIXTURE — see com.sellerops.common.DataOrigin. Default reads exclude non-REAL.';
comment on column order_daily_summaries.data_origin is
    'REAL | DEMO_SEED | VERIFY_FIXTURE — see com.sellerops.common.DataOrigin. Default reads exclude non-REAL.';
