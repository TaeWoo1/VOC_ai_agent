-- NAVER INQUIRY: the declared reference row still said the opposite of what two live runs proved.
--
-- `connector_capabilities` is the reference table the capability screen reads. Its NAVER INQUIRY row
-- was seeded in V3 as `supported=false, NEEDS_VERIFICATION` with the note "TalkTalk consultations not
-- covered by Commerce API; product-Q&A scope unverified." The second half of that sentence was
-- disproven on 2026-08-24: 상품 문의 (`GET /v1/contents/qnas`, 13/13) and 고객 문의
-- (`GET /v1/pay-user/inquiries`, 5/5 + an idempotent re-read) both collected REAL rows with 100%
-- product attribution by channel identifier. `NaverApiConnector.capabilities()` has said so since
-- that proof; this row had not caught up, so the two disagreed.
--
-- The table has one row per (channel, connector class, data type) and no source dimension, so the
-- source split lives in the note — which is the honest place for it: NAVER publishes TWO inquiry
-- resources plus one surface (TalkTalk) that the Commerce API does not cover at all, and a single
-- word can only ever be the fold of those. The fold is the conservative one
-- (`NaverInquiryCollector.fold`): CONFIRMED because every wired source is proven.
--
-- This says nothing about ROUTINE recurrence, which is a separate proof
-- (docs/naver_inquiry_api_audit_v1.md §11–§12) and is NOT claimed here.
update connector_capabilities
set supported = true,
    verification_status = 'CONFIRMED',
    notes = 'Two official read resources, live-proven 2026-08-24: 상품 문의 GET /v1/contents/qnas '
            || '(CONFIRMED) + 고객 문의 GET /v1/pay-user/inquiries (CONFIRMED). '
            || 'TalkTalk consultations remain outside the Commerce API (UNSUPPORTED). '
            || 'Coverage proven from 2026-06-01; routine recurrence not claimed by this row.',
    updated_at = now()
where channel_code = 'NAVER'
  and connector_class = 'API'
  and data_type = 'INQUIRY';
