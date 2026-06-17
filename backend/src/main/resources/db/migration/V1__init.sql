-- SellerOps AI — initial schema (Phase 1).
-- UUID primary keys; org-scoped multi-tenant shape; reference + transactional tables.

create table organizations (
    id          uuid primary key,
    name        varchar(200) not null,
    created_at  timestamptz  not null,
    updated_at  timestamptz  not null
);

create table users (
    id             uuid primary key,
    org_id         uuid not null references organizations (id),
    email          varchar(255) not null unique,
    password_hash  varchar(255) not null,
    name           varchar(120) not null,
    role           varchar(40)  not null,
    created_at     timestamptz  not null,
    updated_at     timestamptz  not null
);
create index idx_users_org on users (org_id);

-- Global channel catalog (default availability + collectable-data badges).
create table channels (
    id                uuid primary key,
    code              varchar(40)  not null unique,
    name_ko           varchar(80)  not null,
    status            varchar(40)  not null,
    supports_inquiry  boolean      not null default false,
    supports_review   boolean      not null default false,
    supports_order    boolean      not null default false,
    supports_sales    boolean      not null default false,
    supports_product  boolean      not null default false,
    sort_order        integer      not null default 0,
    created_at        timestamptz  not null,
    updated_at        timestamptz  not null
);

create table seller_accounts (
    id                 uuid primary key,
    org_id             uuid not null references organizations (id),
    channel_id         uuid not null references channels (id),
    alias              varchar(120),
    connection_status  varchar(40) not null,
    last_synced_at     timestamptz,
    is_file_upload     boolean     not null default false,
    created_at         timestamptz not null,
    updated_at         timestamptz not null
);
create index idx_seller_accounts_org on seller_accounts (org_id);

create table products (
    id          uuid primary key,
    org_id      uuid not null references organizations (id),
    name        varchar(255) not null,
    sku         varchar(120),
    status      varchar(40)  not null,
    created_at  timestamptz  not null,
    updated_at  timestamptz  not null
);
create index idx_products_org on products (org_id);

create table channel_products (
    id                   uuid primary key,
    product_id           uuid not null references products (id),
    channel_id           uuid not null references channels (id),
    external_product_id  varchar(120),
    channel_price        numeric(14, 2),
    created_at           timestamptz not null,
    updated_at           timestamptz not null
);
create index idx_channel_products_product on channel_products (product_id);

create table inquiries (
    id           uuid primary key,
    org_id       uuid not null references organizations (id),
    channel_id   uuid not null references channels (id),
    product_id   uuid references products (id),
    author       varchar(120),
    body         text not null,
    status       varchar(40) not null,
    received_at  timestamptz not null,
    created_at   timestamptz not null,
    updated_at   timestamptz not null
);
create index idx_inquiries_org_received on inquiries (org_id, received_at);

create table reviews (
    id           uuid primary key,
    org_id       uuid not null references organizations (id),
    channel_id   uuid not null references channels (id),
    product_id   uuid references products (id),
    rating       integer,
    body         text not null,
    is_negative  boolean     not null default false,
    received_at  timestamptz not null,
    created_at   timestamptz not null,
    updated_at   timestamptz not null
);
create index idx_reviews_org_received on reviews (org_id, received_at);

create table order_daily_summaries (
    id            uuid primary key,
    org_id        uuid not null references organizations (id),
    channel_id    uuid not null references channels (id),
    summary_date  date    not null,
    order_count   integer not null default 0,
    sales_amount  bigint  not null default 0,
    created_at    timestamptz not null,
    updated_at    timestamptz not null
);
create index idx_order_summaries_org_date on order_daily_summaries (org_id, summary_date);

create table sync_jobs (
    id           uuid primary key,
    org_id       uuid not null references organizations (id),
    channel_id   uuid references channels (id),
    job_type     varchar(40) not null,
    status       varchar(40) not null,
    started_at   timestamptz,
    finished_at  timestamptz,
    created_at   timestamptz not null,
    updated_at   timestamptz not null
);

create table sync_cursors (
    id            uuid primary key,
    org_id        uuid not null references organizations (id),
    channel_id    uuid not null references channels (id),
    cursor_key    varchar(80) not null,
    cursor_value  varchar(255),
    updated_at    timestamptz not null,
    created_at    timestamptz not null
);
