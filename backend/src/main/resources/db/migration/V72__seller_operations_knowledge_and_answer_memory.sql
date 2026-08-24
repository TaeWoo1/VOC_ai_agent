-- 판매자의 운영 지식과, 판매자가 실제로 한 답변의 기억.
--
-- 이 저장소의 지식은 지금까지 전부 **상품 하나에 묶여** 있었다(product_knowledge_sources). 그런데
-- Demo Org의 REAL Cafe24 미답변 backlog 69건을 세어 보면 세금계산서 25 · 현금영수증 17 · 배송 21이고
-- 규격 질문은 1건이다. 상품 지식을 아무리 채워도 이 backlog는 열리지 않는다 -- 없는 것은 상품 지식이
-- 아니라 **회사의 운영 정책**이었다. 여기서 그 축을 만든다.
--
-- **두 개의 표를 만들고, 두 개는 일부러 만들지 않는다.**
--   org_knowledge_*  -- 판매자가 쓴 org 단위 운영 지식 (KnowledgeScope.ORG_OPERATIONS)
--   answer_memory    -- 판매자가 실제로 쓰거나 승인한 답변      (KnowledgeScope.PAST_ANSWER)
-- CHANNEL_FACT(플랫폼이 무엇을 지원하는가)와 ORDER_STATE(이 주문이 지금 어떤 상태인가)에는 표가
-- 없다. 그 둘은 검색 코퍼스에 복사되는 순간 **아무도 편집하지 않았는데 틀려지는 사본**이 된다 --
-- 오늘 아침 발송된 주문이 passage 안에서는 여전히 '결제완료'이고, 초안은 그 passage를 근거로 댄다.
-- 둘은 그 사실을 소유한 결정론적 출처에서 필요한 순간에 읽는다.
--
-- **vector store는 여기서도 만들지 않는다.** org 하나의 운영 정책 문서는 수십 개 규모이고, 과거
-- 답변도 채널이 준 만큼이다. 검색은 KnowledgeRetriever 한 곳에서 결정론적으로 일어난다 -- 같은
-- 질문이 같은 근거를 돌려주는 것이 인용이 근거인 이유다.

create table if not exists org_knowledge_sources (
    id              uuid primary key,
    org_id          uuid not null references organizations(id),
    -- SHIPPING_POLICY | CANCELLATION_POLICY | EXCHANGE_REFUND_POLICY | PAYMENT_POLICY
    -- | TAX_INVOICE | CASH_RECEIPT | GENERAL_CS_FAQ | OTHER -- 닫힌 집합. 애플리케이션이 강제한다.
    knowledge_type  varchar(32) not null,
    title           varchar(200) not null,
    body            text not null,
    source_url      varchar(1000),
    -- 누가 썼는가. 지워진 사용자를 이유로 정책이 사라지면 안 되므로 on delete set null.
    author_user_id  uuid references users(id) on delete set null,
    author_name     varchar(120),
    -- 몇 번째 개정인가. 정책은 **바뀌는 것**이고, 지난주 초안이 어느 판(version)을 근거로 삼았는지
    -- 되짚을 수 없으면 그 초안의 근거는 재현되지 않는다. 본문이 바뀔 때만 오른다.
    version         int not null default 1,
    data_origin     varchar(16) not null default 'REAL',
    created_at      timestamptz not null,
    updated_at      timestamptz not null
);

create index if not exists idx_org_knowledge_sources_org on org_knowledge_sources (org_id);

-- 같은 org에 같은 제목의 정책을 두 번 만들지 않는다. 판매자가 "배송 안내"를 두 번 쓰는 것은 두 개의
-- 정책이 아니라 한 번의 개정이다 -- 그리고 두 판이 동시에 검색되면 초안은 둘 중 하나를 고른다.
create unique index if not exists uq_org_knowledge_sources_title
    on org_knowledge_sources (org_id, title);

create table if not exists org_knowledge_chunks (
    id              uuid primary key,
    org_id          uuid not null references organizations(id),
    source_id       uuid not null references org_knowledge_sources(id) on delete cascade,
    ordinal         int not null,
    content         text not null,
    normalized      text not null,
    created_at      timestamptz not null,
    updated_at      timestamptz not null
);

create index if not exists idx_org_knowledge_chunks_org on org_knowledge_chunks (org_id);
create unique index if not exists uq_org_knowledge_chunks_ordinal
    on org_knowledge_chunks (source_id, ordinal);

-- 판매자가 실제로 한 답변의 기억.
--
-- **AI가 쓴 초안은 여기 들어오지 않는다.** 들어올 수 있는 것은 판매자의 행동이 남은 네 가지뿐이다:
-- 마켓플레이스에서 수집한 판매자 답변, 판매자가 직접 쓴 표준 답변, AI 초안을 판매자가 고쳐서
-- **승인한** 최종본, 그리고 실제로 전송되어 **검증된** 최종본. 승인되지 않은 수정 중인 초안도
-- 아니다 -- 사람이 고치다 만 문장은 그 사람이 하려던 말이 아직 아니다. 이 구분이 무너지면 기억은
-- AI가 자기 추측을 다시 읽고 강화하는 고리가 된다.
--
-- **개인정보는 key가 되지 않는다.** topic_signature는 고객이 쓴 문장이 아니라, 그 질문의 낱말 중
-- **판매자 자신이 쓴 코퍼스에도 나타나는 낱말**만 남긴 것이다(TopicSignature). 고객 이름·주소·
-- 주문번호는 판매자의 정책 문서에 나타나지 않으므로 서명에 들어갈 수 없고, 숫자를 포함한 토큰은
-- 그와 별개로 통째로 버린다. 고객 원문은 여기에 복사되지 않는다 -- inquiries에 이미 있고, 두 벌을
-- 두면 하나를 지워도 하나가 남는다.
create table if not exists answer_memory (
    id                  uuid primary key,
    org_id              uuid not null references organizations(id),
    -- 알려진 경우의 상품 범위. null은 "이 답변은 상품과 무관하다"가 아니라 "묶인 상품을 모른다"이다.
    product_id          uuid references products(id),
    channel_code        varchar(32),
    source_subtype      varchar(32),
    -- 무엇에 대한 답이었나. 검색 대상이자, 고객 원문을 대신하는 유일한 흔적.
    topic_signature     varchar(400) not null,
    -- 결정론적 규칙이 붙인 분류(delivery_status_reply 등). 서명이 비었을 때도 남는 최소한의 주제.
    topic_category      varchar(64),
    answer_title        varchar(300),
    answer_body         text not null,
    normalized          text not null,
    -- IMPORTED_SELLER_ANSWER | USER_APPROVED | EXECUTOR_SENT_VERIFIED
    strength            varchar(32) not null,
    -- 어디서 왔는가. 같은 출처가 두 줄이 되지 않게 하는 멱등 키이기도 하다.
    origin_ref          varchar(160) not null,
    origin_inquiry_id   uuid,
    origin_work_item_id uuid,
    origin_draft_version int,
    author_user_id      uuid references users(id) on delete set null,
    author_name         varchar(120),
    version             int not null default 1,
    data_origin         varchar(16) not null default 'REAL',
    created_at          timestamptz not null,
    updated_at          timestamptz not null
);

create unique index if not exists uq_answer_memory_origin on answer_memory (org_id, origin_ref);
create index if not exists idx_answer_memory_org on answer_memory (org_id, strength);
create index if not exists idx_answer_memory_product on answer_memory (org_id, product_id);
