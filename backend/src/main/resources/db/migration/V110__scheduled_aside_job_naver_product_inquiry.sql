-- Scheduled Aside gains a fourth recipe: the newest page of the seller's own NAVER Seller Center 문의 관리 (상품 문의).
--
-- The CHECK keeps saying what V108 made it say — a recipe this build does not publish cannot be stored — and grows
-- by one name. Nothing else about the job row loosens: still no URL, prompt, script or credential column, still
-- single-use, leased, TTL-bounded and one live job per device.
--
-- One column is new, and it exists because this is the first marketplace recipe whose read can fall short of its
-- own bound. The review recipe reads the screen's whole period; the inquiry screen pages at 8 rows and paging is a
-- click this recipe does not make. Whether the newest page reached everything newer than what was already stored
-- is a fact only the backend can establish (it holds what was stored), so it is judged at delivery and written
-- here beside the counts — never reported by the helper.
--
--   BOUNDED   the page holds the whole period, or its oldest row was already stored: nothing newer was skipped
--   PARTIAL   neither could be shown — the rows were stored, but a gap behind the page cannot be ruled out

alter table scheduled_aside_job
    drop constraint chk_scheduled_aside_job_recipe;

alter table scheduled_aside_job
    add constraint chk_scheduled_aside_job_recipe
        check (recipe in ('CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1', 'COUPANG_REVIEW_OBSERVE_V1',
                          'NAVER_REVIEW_OBSERVE_V1', 'NAVER_PRODUCT_INQUIRY_OBSERVE_V1'));

alter table scheduled_aside_job
    add column delivery_completeness varchar(16);

-- A coverage word exists only beside a proved delivery, and only these two words: COMPLETE is not a thing a page of a
-- marketplace screen can be, and NONE is what a job with no delivery already is.
alter table scheduled_aside_job
    add constraint chk_scheduled_aside_job_delivery_completeness
        check (delivery_completeness is null
               or (delivery_completeness in ('BOUNDED', 'PARTIAL') and identity_verdict = 'MATCH'));

comment on column scheduled_aside_job.delivery_completeness is
    'How far a proved marketplace delivery reached, judged by the backend at delivery. Null for loopback jobs, for reads whose store was not proved, and for recipes whose read is bounded by construction (reviews).';
