-- Conversation Object Integrity v1 — one effective answer state per inquiry.
--
-- An inquiry whose reply was VERIFIED on the channel (inquiry_verification.verified = true, work item
-- COMPLETED) was left with inquiries.status = 'UNANSWERED': the executor only moved the work item, and
-- the inquiry row waited for a connector sweep that, on NAVER, never re-reads answered rows. Rows and
-- counts read the inquiry row; the workload reads the work item — so the same inquiry showed as
-- 「답변 필요」 in one turn and 「답변할 것 없음」 in the next. From this version the verifier writes the
-- inquiry row too; this statement closes the rows verified before it did. answered_at takes the
-- verification's own timestamp (the moment the channel was observed answered), never now().
UPDATE inquiries q
SET status = 'ANSWERED',
    answered_at = COALESCE(q.answered_at, v.verified_at)
FROM (
    SELECT wi.inquiry_id, MIN(iv.created_at) AS verified_at
    FROM inquiry_verification iv
    JOIN inquiry_work_item wi ON wi.id = iv.work_item_id
    WHERE iv.verified = true
      AND wi.phase = 'COMPLETED'
    GROUP BY wi.inquiry_id
) v
WHERE q.id = v.inquiry_id
  AND q.status = 'UNANSWERED';
