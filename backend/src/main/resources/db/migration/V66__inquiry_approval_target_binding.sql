-- Bind an approval to the TARGET, not only to the text.
--
-- The approval already bound the exact draft version + fingerprint, which answers "did the seller
-- read what will be sent". It did not answer "is this still the same place it is being sent to".
-- Everything about the destination — seller account, channel, the inquiry's stable external id, and
-- which source resource it came from — was read fresh at dispatch time off the work item and the
-- inquiry row. So an approval granted for one target could, in principle, be spent on a different
-- one: nothing compared the two.
--
-- These five columns are that comparison's left-hand side: a snapshot, taken inside the same
-- transaction that binds the approval, of the identity the seller was shown. The dispatch now
-- re-derives the same five values and refuses when any of them moved (see
-- InquiryPublishService#revalidate). They are nullable because rows written before this migration
-- have no snapshot to backfill honestly — an absent snapshot is treated as "cannot prove the target
-- is unchanged", which fails closed, rather than being silently filled from today's values.
--
-- No customer data lands here. target_external_id is the marketplace's own handle for the inquiry
-- (a question/inquiry number), which is what the answer endpoint addresses; it is not a buyer
-- identifier, and no buyer name, contact, or body text is stored on this row.

alter table inquiry_approval
    add column if not exists seller_account_id  uuid,
    add column if not exists channel_id         uuid,
    add column if not exists target_external_id varchar(200),
    add column if not exists source_subtype     varchar(32),
    add column if not exists action_kind        varchar(40);

comment on column inquiry_approval.target_external_id is
    'The marketplace handle for the approved inquiry, snapshotted at approval time. Compared at dispatch; a change fails closed.';

-- What the pre-send revalidation could and could not prove.
--
-- "이미 답변된 문의라면 보내지 마" needs a current read of the target's answer state, and SellerOps
-- does not always have one: the stored answered_at/answer_body are as old as the last collection, and
-- a channel whose INQUIRY collection is not currently fresh cannot prove the inquiry is STILL
-- unanswered. Refusing every such send would make the feature unusable on a channel that is merely
-- quiet; proceeding silently would treat an unverified state as a safe one. So the fact is recorded:
-- presend_state_proven is true only when the channel's own collection was provably current at the
-- moment of the send, and presend_note names the closed-vocabulary reason when it was not. The
-- seller sees the same fact on the confirm screen before they press.
alter table inquiry_execution
    add column if not exists presend_state_proven boolean,
    add column if not exists presend_note         varchar(60);
