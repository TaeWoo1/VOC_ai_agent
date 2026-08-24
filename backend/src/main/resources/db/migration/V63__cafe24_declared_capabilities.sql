-- Cafe24 was never declared in `connector_capabilities`, and absence read as "not supported".
--
-- V3 seeded COUPANG and NAVER only; Cafe24 arrived later and its capabilities live in
-- docs/multi-channel-connector-roadmap.md §4.1 and in three live verifications, but never in this
-- table. Nothing read the table per-channel until `ChannelCoverageService`, and the moment something
-- did, the first live read on the canonical Demo Org answered:
--
--     CAFE24 | INQUIRY | NOT_SUPPORTED | rows=113 open=69
--
-- 113 inquiries, 69 of them waiting for an answer, on a channel the runtime had just declared unable
-- to carry inquiries. A missing row is "nobody wrote this down", never "the channel cannot do this",
-- and the service now refuses to read absence as a verdict at all. This migration supplies the rows
-- that were missing, from §4.1 and the proofs it cites:
--
--   ORDER_SUMMARY — API (OAuth), live E2E PASS incl. token rotation and amount reconciliation
--                   (docs/sellerops_cafe24_live_verification.md)
--   REVIEW        — API board 4 (구매후기), live article capture 2026-07-30 (PR #375)
--   INQUIRY       — API board 6 (문의사항), live 2026-07-31 (PR #382); board 9 deliberately not read
--   PRODUCT       — implemented, wire shape never observed ⇒ NEEDS_VERIFICATION, and that is the
--                   honest word: reachable, unproven. It is not a claim that it works.
insert into connector_capabilities
    (id, channel_code, connector_class, data_type, supported, verification_status, notes, created_at, updated_at)
values
    (gen_random_uuid(), 'CAFE24', 'API', 'ORDER_SUMMARY', true,  'CONFIRMED',
     'OAuth order API; live E2E PASS incl. token rotation and amount reconciliation.', now(), now()),
    (gen_random_uuid(), 'CAFE24', 'API', 'REVIEW',        true,  'CONFIRMED',
     'Board 4 (구매후기) article capture; live-verified 2026-07-30. Secret posts fail-closed excluded.', now(), now()),
    (gen_random_uuid(), 'CAFE24', 'API', 'INQUIRY',       true,  'CONFIRMED',
     'Board 6 (문의사항); live-verified 2026-07-31. Board 9 deliberately not collected.', now(), now()),
    (gen_random_uuid(), 'CAFE24', 'API', 'PRODUCT',       true,  'NEEDS_VERIFICATION',
     'Cafe24ProductsClient implemented; wire shape never observed in this repository.', now(), now())
on conflict (channel_code, connector_class, data_type) do nothing;
