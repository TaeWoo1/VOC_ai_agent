-- Fixtures that reached `reviews` through the PRODUCTION ingest path, and so were stored as REAL.
--
-- V54 classified the rows written before `data_origin` existed and got the seeder's exactly right:
-- `MockDataSeeder` builds entities by hand, so its rows carry neither an external id nor a content
-- hash, and that structural rule matched all 44 reviews and 16 inquiries. It also knew one fixture
-- namespace, `VERIFY-%`.
--
-- What it could not know is that three other fixture generators had POSTed CSV to a real local
-- backend. Those rows went through `FileParser` → `ReviewRowMapper` → `IngestionService` exactly as a
-- seller's own export does, so they carry an external id, and the V54 rule — which requires the
-- external id to be ABSENT — passed over every one of them. The ingest path was not wrong: it
-- recorded what it was handed. The lie was upstream, in a test that uploaded manufactured rows into
-- an org that holds a seller's data.
--
-- Measured on the demo database 2026-09-04, and the same three families the repository already
-- enumerates row by row in `contracts/review-eval/naver/v2/synthetic-rows.json` (`inFrame: 23`):
--
--   COLLECTOR-SMOKE-<ts>-N   5   2026-06-17   no generator survives in any ref
--   SYN-<date>-<hex>-000N    3   2026-06-22   no generator survives in any ref
--   awfx-<uuid>             15   2026-07-11…  collector/test/upload.test.ts, three rows per run
--
-- Only the last of the three still had a producer, and this migration lands with its fix: that test
-- now signs up its own throwaway organisation and uploads there, so no further run can reach a
-- seller's corpus (`collector/test/upload.test.ts`).
--
-- The classification is `VERIFY_FIXTURE`, the value the enum already defines for exactly this —
-- "written by a live-verification run to prove a code path end to end; real in shape and synthetic in
-- origin". No new origin, no widened contract, no change to what REAL means.
--
-- These rows are NOT deleted, for the same reason V54 deleted nothing, and for one more: the review
-- evaluation corpus lists all 23 by fingerprint and reports every reading with and without them. That
-- contract keys on the review-id fingerprint, not on `data_origin`, and the calibration tools do not
-- read this column at all — so the pre-committed sample and its frame are untouched by this.

-- ---------------------------------------------------------------------------------------------
-- Reserved fixture namespaces, matched on their WHOLE documented shape rather than on a prefix, so a
-- future id that merely begins with one of these letters is not swept up. A real NAVER 리뷰글번호 is a
-- 10-digit number (contracts/review-id-fingerprint/v1/SPEC.md), so none of these can name an export
-- row; verified against the demo database, each pattern matches its family exactly (15 / 3 / 5) and
-- zero 10-digit ids. On a database that never ran these fixtures the statement matches nothing.
-- ---------------------------------------------------------------------------------------------
update reviews set data_origin = 'VERIFY_FIXTURE'
 where data_origin = 'REAL'
   and (external_id ~ '^awfx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or external_id ~ '^SYN-[0-9]{8}-[0-9a-f]+-[0-9]+$'
     or external_id ~ '^COLLECTOR-SMOKE-[0-9]+-[0-9]+$');

-- Derived rows inherit the source's classification — V55's rule, re-applied now that its input is
-- correct. Same join, same "a derivation whose source has since disappeared keeps REAL" reasoning.
update item_analyses a
   set data_origin = s.origin
  from (select r.id, r.data_origin::text as origin, 'REVIEW' as kind from reviews r) s
 where s.id = a.source_id and s.kind = a.source_type and a.data_origin = 'REAL' and s.origin <> 'REAL';

update customer_memory_entries e
   set data_origin = s.origin
  from (select r.id, r.data_origin::text as origin, 'REVIEW' as kind from reviews r) s
 where s.id = e.source_id and s.kind = upper(e.entry_kind)
   and e.data_origin = 'REAL' and s.origin <> 'REAL';

-- ---------------------------------------------------------------------------------------------
-- V56's evidence rule, re-applied ONLY where this migration changed the evidence.
--
-- A product is real when at least one REAL review or inquiry supports it. Some demo products were
-- held up as real by nothing but the fixture rows above, so their misclassification was always a
-- CONSEQUENCE of the reviews' — correcting the cause is what makes re-running the existing rule the
-- whole of the fix. The statements below are V56's, with one clause added.
--
-- <b>That added clause is the point.</b> Running V56's rule unrestricted would also sweep rows V56
-- never saw, because it ran once and products have been created since: measured before this clause
-- was added, it demoted `(미지정 상품)` — ingest's own placeholder bucket, which `ProductService`
-- looks up BY NAME, so hiding it behind the filter would have made the next unattributed ingest
-- create a second one — and a bare Cafe24 product code with no reviews yet, which is a real product
-- the seller sells. Neither is a fixture, neither has anything to do with the cause fixed here, and
-- whether V56's rule should be re-run over the whole catalogue is a separate question this migration
-- does not answer.
--
-- So the demotion is restricted to rows a fixture review actually held up. Combined with the REAL
-- clauses it can never demote a row any real evidence supports, which makes a REAL→non-REAL
-- regression structurally impossible rather than merely unintended.
-- ---------------------------------------------------------------------------------------------
update channel_products cp
   set data_origin = 'DEMO_SEED'
 where cp.data_origin = 'REAL'
   and cp.source_kind like 'DERIVED:%'
   and exists (select 1 from reviews f
                where f.product_id = cp.product_id and f.channel_id = cp.channel_id
                  and f.data_origin = 'VERIFY_FIXTURE')
   and not exists (select 1 from reviews r
                    where r.product_id = cp.product_id and r.channel_id = cp.channel_id
                      and r.data_origin = 'REAL')
   and not exists (select 1 from inquiries q
                    where q.product_id = cp.product_id and q.channel_id = cp.channel_id
                      and q.data_origin = 'REAL');

update products p
   set data_origin = 'DEMO_SEED'
 where p.data_origin = 'REAL'
   and exists (select 1 from reviews f
                where f.product_id = p.id and f.data_origin = 'VERIFY_FIXTURE')
   and not exists (select 1 from reviews r where r.product_id = p.id and r.data_origin = 'REAL')
   and not exists (select 1 from inquiries q where q.product_id = p.id and q.data_origin = 'REAL')
   and not exists (select 1 from channel_products cp
                    where cp.product_id = p.id and cp.data_origin = 'REAL');
