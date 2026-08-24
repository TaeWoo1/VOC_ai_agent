-- Inquiry Workflow Completion v2 · PART B — 문의가 어떤 상품에 묶였는지, 그리고 그것을 누가 정했는지.
--
-- V70이 남긴 사실: Cafe24 board 6은 product_no를 거의 주지 않는다 (REAL 3,312건 중 정확 귀속 5건).
-- 그 3,307건을 자동 추측으로 메우는 것은 금지돼 있고, 옳다. 대신 사람이 직접 지정할 수 있게 하되,
-- 사람이 지정한 것과 소스가 준 것을 절대 같은 사실로 취급하지 않는다.
--
--   SOURCE_EXACT   채널 자신의 상품 식별자가 channel_products와 정확히 일치했다.
--   USER_CONFIRMED 사람이 화면에서 이 상품이라고 지목했다.
--   (null)         product_id가 없다 — 또는 이 컬럼이 생기기 전에 붙은 오래된 귀속.
--
-- 둘을 나누는 이유는 신뢰도가 달라서가 아니라 반증 방법이 달라서다. 전자는 소스를 다시 읽으면
-- 확인되고, 후자는 지목한 사람에게 물어야 한다.

alter table inquiries add column if not exists product_binding varchar(16);
alter table inquiries add column if not exists product_bound_at timestamptz;
alter table inquiries add column if not exists product_bound_by uuid;

comment on column inquiries.product_binding is
  'SOURCE_EXACT | USER_CONFIRMED — product_id가 어떻게 정해졌는지. null이면 미지정이거나 V71 이전 귀속.';

-- 기존 귀속은 전부 소스가 정한 것이다: V70까지 사람이 상품을 지정할 방법 자체가 없었다.
update inquiries set product_binding = 'SOURCE_EXACT' where product_id is not null and product_binding is null;

-- 바뀐 내역은 덮어쓰지 않고 쌓는다. 상품을 잘못 지목했다가 고친 흔적은 그 자체로 운영 기록이고,
-- 초안이 어떤 상품 지식을 근거로 썼는지 나중에 되짚을 수 있는 유일한 길이다.
create table if not exists inquiry_product_binding_events (
    id                  uuid primary key,
    org_id              uuid        not null,
    inquiry_id          uuid        not null,
    previous_product_id uuid,
    previous_binding    varchar(16),
    product_id          uuid        not null,
    binding             varchar(16) not null,
    actor_user_id       uuid,
    actor_name          varchar(200),
    created_at          timestamptz not null default now()
);

create index if not exists idx_inquiry_product_binding_events_inquiry
    on inquiry_product_binding_events (inquiry_id, created_at desc);
