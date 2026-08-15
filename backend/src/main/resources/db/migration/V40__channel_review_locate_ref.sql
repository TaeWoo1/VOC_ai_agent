-- `[쿠팡에서 보기]` — the binding that lets a guided run find ONE stored review on the seller's own
-- WING screen without anything that identifies it crossing the Action Window boundary.
--
-- WHY A REF AT ALL, when the run only draws a ring. Coupang publishes no review id
-- (docs/coupang_review_policy_gate_v1.md §9.2), so a stored review is re-found on the screen by
-- everything that agrees: 노출상품ID, 옵션ID, 등록일, 별점, and a one-way fingerprint of the body.
-- Taken together those fields ARE a description of one buyer's review, and the contract's privacy
-- invariant forbids exactly that on the wire. So the backend mints an opaque token here, the frontend
-- passes only the token into START_RUN, and the Local Agent resolves it over its OWN authenticated
-- backend session. The description never travels between them.
--
-- SINGLE USE, AND SHORT LIVED. A ref is spent the first time it is resolved: a run holds the target in
-- memory for its lifetime, so re-pressing 다시 확인 needs no second resolve, and a token that survived
-- its run would be a re-findable handle to a buyer's review sitting in a log. `expires_at` bounds the
-- window between the seller pressing the button and the agent asking, which is seconds in practice.
--
-- NO seller_account_id and NO channel_id, for the reasons V19/V20 already state: `reviews` carries no
-- account, and the channel is re-derived from the review at mint time (where it is CHECKED — a review
-- from another of the org's channels is refused rather than minted against).
--
-- Additive only. IF NOT EXISTS keeps a re-run safe, matching V18/V19/V20.

create table if not exists channel_review_locate_ref (
    id          uuid         primary key,
    org_id      uuid         not null references organizations (id),
    review_id   uuid         not null references reviews (id),
    locate_ref  varchar(16)  not null,
    created_by  varchar(120) not null,
    created_at  timestamptz  not null,
    expires_at  timestamptz  not null,
    -- Null until the agent resolves it. Set exactly once; a second resolve finds it non-null and refuses.
    consumed_at timestamptz
);

-- Opaque and globally unique, like `review_reply_submission_ref.submission_ref`. A 16-hex collision
-- fails closed here rather than pointing two runs at one row.
create unique index if not exists uq_channel_review_locate_ref_ref
    on channel_review_locate_ref (locate_ref);

-- The resolve path is a lookup by ref alone (the agent holds no org context but its own JWT's), and the
-- unique index above already serves it. This one serves the sweep that expires old rows and the
-- per-review audit "which runs went looking for this".
create index if not exists idx_channel_review_locate_ref_review
    on channel_review_locate_ref (org_id, review_id, created_at desc);

comment on table channel_review_locate_ref is
    'Single-use opaque binding from a REVIEW_LOCATE Action Window run to one stored review. Carries no '
    'product id, date, rating, or body fingerprint — those are resolved server-side from the review and '
    'handed to the Local Agent over its own authenticated session, never over the Action Window wire.';
