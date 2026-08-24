-- 판매자가 직접 쓴 상품 지식을 보존하고, 검색 단위로 쪼개 둔다.
--
-- 이 저장소에는 이미 product_facts가 있다. 그것은 **채널이 말한 사실**이다 -- NAVER 상품 API가
-- 준 규격, Coupang이 준 옵션, Cafe24가 준 리스팅. 여기 새로 생기는 것은 **판매자가 쓴 지식**이다:
-- 사용법, FAQ, 교환/반품 정책, 상세페이지 문장. 두 축은 절대 섞지 않는다. provenance가 다르고,
-- Evidence Judge가 그 차이로 문장을 판정하기 때문이다 -- "채널이 그렇게 적어 두었다"와
-- "판매자가 그렇게 말했다"는 같은 무게의 근거가 아니다.
--
-- **vector store를 만들지 않는다.** 한 상품의 지식 코퍼스는 구조적으로 작다(문서 몇 개, 조각
-- 수십 개). 그리고 검색은 언제나 "상품 하나 안에서" 일어난다 -- Agent가 상품을 먼저 확정한
-- 뒤에야 지식을 묻기 때문이다. 그 규모에서 근사 최근접 이웃 색인은 답을 좋게 만들지 않고
-- 운영 부담과 비결정성만 더한다. 조각은 Java에서 결정론적으로 채점되고, 같은 질문은 같은
-- 근거를 돌려준다 -- 재현 가능한 evidence의 전제다.
--
-- 조각(chunk)을 따로 저장하는 이유는 색인이 아니라 **인용**이다. 답변이 근거로 대는 것은
-- 문서 전체가 아니라 그 안의 한 대목이어야 하고, 그 대목은 안정된 식별자를 가져야 한다.

create table if not exists product_knowledge_sources (
    id              uuid primary key,
    org_id          uuid not null references organizations(id),
    product_id      uuid not null references products(id),
    -- DESCRIPTION | FAQ | USAGE | POLICY | LINK -- 닫힌 집합. 애플리케이션이 강제한다.
    source_type     varchar(24) not null,
    title           varchar(200) not null,
    body            text not null,
    -- LINK 타입이 가리키는 원문 주소. 이 마이그레이션은 그 주소를 **가져오지 않는다** --
    -- 자동 수집은 별도 승인이 필요한 행위이고, 여기 남는 것은 판매자가 적어 둔 출처 표기다.
    source_url      varchar(1000),
    -- 누가 썼는가. 지워진 사용자를 이유로 지식이 사라지면 안 되므로 on delete set null.
    author_user_id  uuid references users(id) on delete set null,
    author_name     varchar(120),
    data_origin     varchar(16) not null default 'REAL',
    created_at      timestamptz not null,
    updated_at      timestamptz not null
);

create index if not exists idx_pk_sources_product on product_knowledge_sources (org_id, product_id);

-- 같은 상품에 같은 제목의 문서를 두 번 만들지 않는다. 판매자가 "사용법"을 두 번 쓰는 것은
-- 두 개의 지식이 아니라 한 번의 수정이다.
create unique index if not exists uq_pk_sources_title
    on product_knowledge_sources (org_id, product_id, title);

create table if not exists product_knowledge_chunks (
    id              uuid primary key,
    org_id          uuid not null references organizations(id),
    product_id      uuid not null references products(id),
    source_id       uuid not null references product_knowledge_sources(id) on delete cascade,
    -- 문서 안에서의 순서. 인용문이 "세 번째 대목"이라고 말할 수 있게 한다.
    ordinal         int not null,
    content         text not null,
    -- 채점에 쓰는 정규화된 형태(공백/문장부호 제거, 소문자화). 읽을 때마다 다시 만들면
    -- 정규화 규칙이 바뀐 순간 과거 조각과 새 조각의 점수가 조용히 달라진다.
    normalized      text not null,
    created_at      timestamptz not null,
    updated_at      timestamptz not null
);

create index if not exists idx_pk_chunks_product on product_knowledge_chunks (org_id, product_id);
create unique index if not exists uq_pk_chunks_ordinal
    on product_knowledge_chunks (source_id, ordinal);
