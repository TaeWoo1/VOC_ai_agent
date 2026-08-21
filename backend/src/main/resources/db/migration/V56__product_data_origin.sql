-- Product Knowledge is derived, so it inherits the honesty of what it was derived FROM.
--
-- Every channel_products row in the demo org is DERIVED:INGEST — assembled from rows already held,
-- with no channel call. Which means a listing can exist purely because a seeded review claimed a
-- product was sold somewhere it never was: measured on 2026-08-22, all 3 Coupang listings and 3 of 47
-- NAVER listings rest on synthetic evidence alone, and Coupang has no credential and has never run a
-- sync in this database. "이 상품을 쿠팡에서도 팔고 있습니다" was a statement the product invented
-- about itself and would have said to the Agent as fact.
--
-- The rule is evidence-based rather than name-based: a derived row is real when at least one REAL
-- review or inquiry supports it. Matching the seeder's SKU pattern would have been shorter and would
-- have missed the three NAVER listings, which carry no seeder marker at all.

alter table channel_products add column if not exists data_origin varchar(20) not null default 'REAL';
alter table products         add column if not exists data_origin varchar(20) not null default 'REAL';

-- A derived listing with no real evidence behind it is a claim about where the seller sells, made out
-- of nothing. Only DERIVED rows are reclassified: a listing read from the channel's own catalogue is
-- evidence in its own right and needs no corroboration.
update channel_products cp
   set data_origin = 'DEMO_SEED'
 where cp.data_origin = 'REAL'
   and cp.source_kind like 'DERIVED:%'
   and not exists (select 1 from reviews r
                    where r.product_id = cp.product_id and r.channel_id = cp.channel_id
                      and r.data_origin = 'REAL')
   and not exists (select 1 from inquiries q
                    where q.product_id = cp.product_id and q.channel_id = cp.channel_id
                      and q.data_origin = 'REAL');

-- A product nothing real ever mentioned. Kept, not deleted — the seeded reviews still point at it and
-- a dangling reference is worse than an unlisted product.
update products p
   set data_origin = 'DEMO_SEED'
 where p.data_origin = 'REAL'
   and not exists (select 1 from reviews r where r.product_id = p.id and r.data_origin = 'REAL')
   and not exists (select 1 from inquiries q where q.product_id = p.id and q.data_origin = 'REAL')
   and not exists (select 1 from channel_products cp
                    where cp.product_id = p.id and cp.data_origin = 'REAL');

comment on column channel_products.data_origin is
    'REAL | DEMO_SEED | VERIFY_FIXTURE. A DERIVED listing is REAL only if real evidence supports it.';
comment on column products.data_origin is
    'REAL | DEMO_SEED | VERIFY_FIXTURE. Default reads exclude non-REAL.';
