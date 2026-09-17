-- Scheduled Aside v1 gains its first MARKETPLACE recipes: one page of the seller's own Coupang WING 리뷰 목록, and the
-- default period of the seller's own NAVER Seller Center 리뷰 목록.
--
-- V108 constrained `recipe` to the single loopback-fixture value, and said why: «a job naming anything else
-- cannot be stored, so an unknown recipe is impossible rather than unhandled». That property is not being
-- relaxed here — the CHECK still names every recipe this build publishes, and a third one would need another
-- migration. What changes is the size of the list, from one to three.
--
-- The new value is the first recipe that reads a MARKETPLACE rather than a surface this repository serves
-- itself, so it is worth writing down what did NOT change with it:
--
--   no target column      there is still no column for a URL, a prompt, a script or a credential. The helper
--                         resolves this name to the one WING route its own bound workflow publishes, and
--                         screens that route with the product's WING classifier before opening anything —
--                         the same shape as the loopback recipe screening for loopback
--   single use            `status` still leaves QUEUED exactly once, still at most one live job per device,
--                         still TTL- and lease-bounded. «Scheduled» loosened no bound the pressed run had
--   no write              the bound workflow reads one page: zero clicks, zero keystrokes, zero downloads,
--                         zero marketplace writes, and no model call
--   identity fence        unchanged and upstream of every row: a page whose store does not match the digest of
--                         the account's own vendor code drops its reading unread
--
-- Authorisation moved, and only that: from a seller pressing 지금 동기화 once per read, to the seller
-- activating the responsibility plus a deployment naming this organisation AND this seller account
-- (`AsideMarketplaceAccess`, default off, no wildcard).

alter table scheduled_aside_job
    drop constraint chk_scheduled_aside_job_recipe;

alter table scheduled_aside_job
    add constraint chk_scheduled_aside_job_recipe
        check (recipe in ('CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1', 'COUPANG_REVIEW_OBSERVE_V1',
                          'NAVER_REVIEW_OBSERVE_V1'));

-- What a marketplace read DELIVERED, written by the backend's own ingest — never by the helper's report.
--
-- The loopback recipe's «new» is a digest comparison because its surface has nothing to store. A marketplace
-- read stores reviews, so the only honest «new» is the number of canonical rows this read inserted and the only
-- honest «changed» is the number of already-stored reviews whose reply state this read advanced. Both are
-- counted where ingest happens and recorded here against the job, so the run's source row quotes the spine
-- rather than trusting a number the helper computed.
alter table scheduled_aside_job
    add column inserted_count integer,
    add column changed_count  integer,
    add column identity_verdict varchar(16);

alter table scheduled_aside_job
    add constraint chk_scheduled_aside_job_identity
        check (identity_verdict is null or identity_verdict in ('MATCH', 'MISMATCH', 'UNRESOLVED'));

-- A delivery count exists only for a read whose store was proved. An unproven store ingests nothing, so it has
-- nothing to count — and a job that never reached delivery has no identity verdict at all.
alter table scheduled_aside_job
    add constraint chk_scheduled_aside_job_delivery
        check ((inserted_count is null and changed_count is null) or identity_verdict = 'MATCH');

comment on column scheduled_aside_job.recipe is
    'The published recipe. Constrained to the values this build publishes: an unknown recipe cannot be stored. The marketplace recipes read the seller''s own store screen and are gated per organisation and per seller account.';
