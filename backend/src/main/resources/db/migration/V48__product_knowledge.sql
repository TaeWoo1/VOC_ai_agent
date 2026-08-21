-- Product Knowledge v2 — what SellerOps is actually selling, with a source and a timestamp on every
-- fact it claims.
--
-- WHY THIS EXISTS. Until now the entire product context in SellerOps was `products.name` and
-- `products.sku` — a title and an identifier (measured: docs/slices/product-context-diagnosis-
-- groundwork.md §3, "no product/catalog client exists on any channel"). An agent asked "폭이 몇
-- mm인가요?" had nothing to read, and an agent asked "X상품 문제 있어?" could not tell a product with
-- no problems from a product it knows nothing about. Operator Graph v2 makes product facts EVIDENCE,
-- and evidence without a source is not evidence.
--
-- ============================================================================================
-- VERSION NUMBERING
-- V48 — the next free version above main's max (V47 = customer memory index). Flyway `out-of-order`
-- is NOT enabled, so a version at or below main's max would fail boot on an already-migrated DB.
-- ============================================================================================
--
-- WHAT IS AND IS NOT STORED. Everything here is SELLER-OWNED catalogue data — the seller's own
-- listing title, price, option names, description, spec attributes. No customer utterance, no buyer
-- identity, no order line. Nothing here is inferred: a value only exists if a source stated it, and
-- `source` + `observed_at` are NOT NULL for exactly that reason (see ProductFact.confidence, whose
-- INFERRED value has no producer).
--
-- WHY channel_products IS EXTENDED RATHER THAN REPLACED. The table has existed since V1 and holds
-- ZERO rows (same audit, §2) — it was created for precisely this purpose and never wired. Its
-- (product_id, channel_id, external_product_id, channel_price) columns are the right ones. Adding a
-- second "product listings" table beside an empty one with the same meaning is how a schema acquires
-- two answers to one question.

-- ── 1. channel_products: the listing, per channel ────────────────────────────────────────────
alter table channel_products add column if not exists org_id uuid references organizations (id);
-- The listing's own title on that channel. `products.name` is SellerOps' single display name;
-- this is what the channel shows, and the two legitimately differ (a mall renames, a marketplace
-- appends option text). Keeping both is what lets a seller recognise their own listing.
alter table channel_products add column if not exists channel_product_name varchar(500);
alter table channel_products add column if not exists product_url varchar(1000);
-- Channel status verbatim is NOT stored; this is the minimal normalization (SELLING / SUSPENDED /
-- ENDED / UNKNOWN), fail-closed to UNKNOWN, mirroring channel_orders.normalized_status.
alter table channel_products add column if not exists selling_status varchar(24);
alter table channel_products add column if not exists currency varchar(8);
-- Which read produced this row: e.g. NAVER:PRODUCT_API:v1, CAFE24:PRODUCT_API:v2,
-- COUPANG:SELLER_PRODUCTS:v1, or DERIVED:INGEST (assembled from an already-ingested review/inquiry).
alter table channel_products add column if not exists source_kind varchar(64);
-- The DATA's own observation time, not the row's write time. Staleness is computed from this.
alter table channel_products add column if not exists observed_at timestamptz;
alter table channel_products add column if not exists first_seen_at timestamptz;
alter table channel_products add column if not exists last_seen_at timestamptz;

-- Identity moves to the CHANNEL's own id. `ProductService.resolveOrCreate` keys on SKU and falls back
-- to an exact NAME match, so a seller who edits a listing title silently gets a second `products` row
-- and splits their own review history — measured, and nothing detects it today. A listing keyed by
-- (channel, external id) cannot split that way. Partial so pre-existing null-id rows (there are none)
-- and derived rows with no channel id are tolerated.
create unique index if not exists uq_channel_products_external
    on channel_products (channel_id, external_product_id) where external_product_id is not null;
create index if not exists idx_channel_products_org on channel_products (org_id);

-- ── 2. product_variants: option / SKU granularity ────────────────────────────────────────────
-- A review or inquiry is about a product; a complaint is usually about an OPTION ("검정색만 색이
--달라요"). Coupang already stores reviews.source_option_id (V37) with nowhere to resolve it to.
create table if not exists product_variants (
    id                   uuid primary key,
    org_id               uuid         not null references organizations (id),
    product_id           uuid         not null references products (id),
    channel_id           uuid         references channels (id),
    -- The channel's own option id (Coupang vendorItemId, NAVER optionId, Cafe24 variant_code).
    external_variant_id  varchar(120),
    option_name          varchar(500),
    sku                  varchar(120),
    price                numeric(14, 2),
    selling_status       varchar(24),
    source               varchar(64)  not null,
    observed_at          timestamptz  not null,
    created_at           timestamptz  not null,
    updated_at           timestamptz  not null
);
create unique index if not exists uq_product_variants_external
    on product_variants (org_id, product_id, external_variant_id) where external_variant_id is not null;
create index if not exists idx_product_variants_product on product_variants (org_id, product_id);

-- ── 3. product_facts: one stated fact, with who said it and when ─────────────────────────────
-- fact_key is namespaced so a reader can tell a channel attribute from a derived one WITHOUT
-- consulting `source`: `spec:*` (structured attribute), `attr:*` (channel attribute), `desc:*`
-- (description text), `taxonomy:*` (category / brand / manufacturer).
--
-- The unique key includes `source`, deliberately: two channels legitimately state a different price
-- or a different category for the same product, and collapsing them would make the last writer win
-- silently. A reader that wants one value picks by coverage/recency and SAYS which source it used.
create table if not exists product_facts (
    id           uuid         primary key,
    org_id       uuid         not null references organizations (id),
    product_id   uuid         not null references products (id),
    fact_key     varchar(120) not null,
    fact_value   text         not null,
    unit         varchar(32),
    -- e.g. NAVER:PRODUCT_API:v1 — the same vocabulary channel_products.source_kind uses.
    source       varchar(64)  not null,
    -- The channel-side identifier the fact was read from (channel product no / article no), so a
    -- claim can be traced to one row on one channel rather than to "the NAVER API".
    source_ref   varchar(120),
    observed_at  timestamptz  not null,
    -- SOURCE_STATED | DERIVED. INFERRED exists in the enum and has no producer — a value guessed
    -- from other values is exactly what invariant I3 forbids.
    confidence   varchar(24)  not null,
    created_at   timestamptz  not null,
    updated_at   timestamptz  not null
);
create unique index if not exists uq_product_facts_key
    on product_facts (org_id, product_id, fact_key, source);
create index if not exists idx_product_facts_product on product_facts (org_id, product_id);
