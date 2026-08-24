-- NAVER INQUIRY — routine recurrence는 이제 증명됐고, 참조 테이블이 그렇게 말하지 않는다.
--
-- V62가 이 행의 반증된 문장을 고쳤을 때 남긴 유보가 "routine recurrence not claimed by this row"였다.
-- 그 유보는 2026-08-24 15:15의 실패(토큰 발급 거절)에서 나온 것이고, 같은 날 20:54에 실제 60분
-- schedule이 두 lane을 한 run에서 돌렸다(L2 2/0/2/0, L3 0/0/0/0). 유보를 남겨 두면 이 행을 읽는
-- 다음 사람이 이미 증명된 것을 다시 증명하려 한다.
--
-- 옮기지 않는 것: source 판정 두 개는 이미 CONFIRMED였고 그대로다. TalkTalk도 그대로 커머스 API
-- 밖이다. 답변 등록(WRITE)에 대해서는 이 행이 아무 말도 하지 않으며, 이 마이그레이션도 그렇다.
update connector_capabilities
   set notes = 'Two official read resources, live-proven 2026-08-24: 상품 문의 GET /v1/contents/qnas '
               || '(CONFIRMED) + 고객 문의 GET /v1/pay-user/inquiries (CONFIRMED). TalkTalk consultations '
               || 'remain outside the Commerce API (UNSUPPORTED). Coverage proven from 2026-06-01. '
               || 'Routine recurrence CONFIRMED 2026-08-24: one 60m schedule ran both lanes in a single '
               || 'run over the 14-day ROUTINE_MAX_LAG window, and an immediate re-run resumed at the '
               || 'previous windowTo with zero rows and zero duplicates. READ only — this row says '
               || 'nothing about posting an answer.',
       updated_at = now()
 where channel_code = 'NAVER'
   and data_type = 'INQUIRY';
