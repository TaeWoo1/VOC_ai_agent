-- 문의가 가리키는 주문 — source가 말해 준 것만.
--
-- **왜 컬럼 두 개뿐인가.** ORDER_STATE는 검색 코퍼스를 갖지 않는다(V72). 그 결정은 그대로다:
-- 주문 상태는 아무도 편집하지 않았는데 틀려지는 사실이고, 여기에 복사되는 순간 오늘 발송된 주문이
-- 문의 행 안에서는 영원히 '결제완료'가 된다. 그래서 저장하는 것은 **상태가 아니라 참조**다 --
-- "이 문의는 저 주문에 대한 것이다" 한 문장. 상태는 필요한 순간 channel_orders에서 읽는다.
--
-- **왜 평문인가.** 같은 식별자 공간이 이 데이터베이스에 이미 평문으로 있다 --
-- channel_orders.external_order_id(NAVER productOrderId)와 parent_order_id(NAVER orderId).
-- 문의 쪽만 HMAC으로 덮으면 보호되는 것은 없고(원본이 옆 표에 있다) 정확 조회 경로만 사라진다.
-- 주문 식별자는 거래의 손잡이이지 사람의 손잡이가 아니다 -- 구매자 이름·연락처·주소·customerId는
-- 이 패키지에서도 여전히 투영되지 않고 저장되지 않는다.
--
-- **읽는 곳은 하나다.** InquiryOrderFactReader가 channel_orders와 정확 일치시킬 때만 읽는다.
-- 초안 프롬프트에 나가지 않고(payload floor), Answer Memory에 복사되지 않으며(구조 fence),
-- coverage 보고서와 화면에는 숫자가 아니라 상태만 나간다.
--
-- **보존.** 문의 행의 수명과 같다 -- 이 열은 문의의 속성이지 별도 수명을 가진 기록이 아니다.
-- 채널이 다시 말해 주면 갱신되고(verbatim), 채널이 침묵하면 그대로 남는다.

alter table inquiries
    -- 채널이 준 주문 식별자, 그대로. 상품주문 단위가 있으면 그것(정확), 없으면 결제 단위(범위).
    add column if not exists source_order_ref varchar(120),
    -- InquiryOrderBinding. 값은 SOURCE_EXACT 하나뿐이고, null은 '묶이지 않음'이다.
    add column if not exists order_binding varchar(16);

-- 역방향 조회(이 주문에 대한 문의가 또 있나)는 아직 아무도 하지 않지만, 정방향 조회는 문의 상세를
-- 열 때마다 일어난다. 부분 인덱스로 묶인 행에만 값을 치른다 -- 오늘 Demo Org에서 그것은 0행이다.
create index if not exists idx_inquiries_source_order_ref
    on inquiries (org_id, source_order_ref)
    where source_order_ref is not null;

comment on column inquiries.source_order_ref is
    '채널이 이 문의 행에 명시한 주문 식별자(verbatim). 본문에서 추출하지 않는다.';
comment on column inquiries.order_binding is
    'SOURCE_EXACT 또는 null. 주문 결합에는 사람이 고르는 lane이 없다.';
