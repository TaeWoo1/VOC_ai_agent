-- 문의의 출처 종류(source subtype)를 보존한다.
--
-- 한 채널이 문의를 한 종류만 주지는 않는다. NAVER는 상품 문의(스마트스토어 Q&A,
-- GET /v1/contents/qnas)와 고객 문의(네이버페이, GET /v1/pay-user/inquiries)를 서로 다른
-- 리소스로 준다: 식별자 공간이 다르고(questionId vs inquiryNo), 앞의 것은 리스팅에 달리고
-- 뒤의 것은 주문에 달린다. 둘을 하나의 문의 화면에 함께 보여줄 수는 있지만, 어느 리소스가
-- 준 행인지를 잃으면 다시 만들 수 없다 -- 재수집도, 커버리지 진술도, 실패 격리도 전부
-- "어느 source의 행인가"에 기대기 때문이다.
--
-- NULL은 정직한 값이다: 이 컬럼이 생기기 전에 들어온 행과, 출처를 한 종류만 갖는 경로
-- (파일 업로드, ESM, Cafe24 게시판)는 subtype을 주장하지 않는다. 새 값을 소급해서
-- 채워 넣지 않는다 -- 그것은 관측이 아니라 추측이다.
alter table inquiries add column if not exists source_subtype varchar(32);

-- 재수집이 자기 source의 행을 찾는 경로. external_id는 이미 (org, channel) 안에서 조회되므로
-- 이 인덱스는 커버리지/집계가 source별로 세는 것을 위한 것이다.
create index if not exists idx_inquiries_org_channel_subtype
    on inquiries (org_id, channel_id, source_subtype);

-- 판매자가 이미 플랫폼에 남긴 답변.
--
-- 지금까지 어느 채널도 이것을 보존하지 않았다 -- answered 여부(boolean)만 남기고 답변 본문은
-- 버렸다. NAVER의 두 문의 리소스는 답변 본문(answer / answerContent)과 답변 등록 시각을 함께
-- 주고, 그것은 "이 문의는 이미 처리됐다"와 "이 문의에 무엇이라고 답했다"의 차이다 -- 뒤의 것이
-- 없으면 반복 문의 판단도, 답변 초안도 이미 있는 답을 못 본 채로 만들어진다.
--
-- 채널 중립 컬럼이다: 답변 본문을 주지 않는 source는 NULL로 남긴다. 추측해서 채우지 않는다.
alter table inquiries add column if not exists answer_body text;
alter table inquiries add column if not exists answered_at timestamptz;
