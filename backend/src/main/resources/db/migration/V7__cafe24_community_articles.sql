-- PR A: Cafe24 community board article capture — dedicated canonical storage.
--
-- Reviews/inquiries collected from Cafe24 community boards are stored here, NOT in
-- the shared insert-only reviews/inquiries tables, because Cafe24 articles need
-- board/article identity, source_kind, reply_status, source timestamps, rating,
-- product_no, and hash-guarded upsert. DataType.REVIEW / DataType.INQUIRY are reused
-- only at the runtime/scheduling layer; this table is the durable storage asset.
--
-- Additive only. IF NOT EXISTS keeps re-runs/partial-applies safe.

create table if not exists cafe24_community_articles (
    id                 uuid        primary key,
    org_id             uuid        not null,
    seller_account_id  uuid        not null,
    channel_id         uuid        not null,
    board_no           integer     not null,
    article_no         bigint      not null,
    source_kind        varchar(40) not null,
    product_no         bigint,
    title              text,
    content            text,
    rating             integer,
    reply_status       varchar(40) not null,
    source_created_at  timestamptz,
    source_updated_at  timestamptz,
    source_hash        varchar(64) not null,
    collected_at       timestamptz not null,
    created_at         timestamptz not null,
    updated_at         timestamptz not null
);

-- Natural key for hash-guarded upsert: one row per article within a connected mall.
create unique index if not exists uq_cafe24_articles_natural
    on cafe24_community_articles (channel_id, seller_account_id, board_no, article_no);

-- Incremental sweeps and backfills read by (org, seller account, board).
create index if not exists idx_cafe24_articles_board
    on cafe24_community_articles (org_id, seller_account_id, board_no);
