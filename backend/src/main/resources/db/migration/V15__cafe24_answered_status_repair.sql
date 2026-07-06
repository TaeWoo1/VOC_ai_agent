-- Cafe24 reply_status 'C' (처리완료) was previously unrecognized and mapped to
-- UNANSWERED, so already-answered inquiries were stored as UNANSWERED and each
-- incorrectly opened an OPEN work item (a phantom seller task). The connector mapping
-- is fixed forward (C -> ANSWERED, and answered inquiries no longer open a work item).
-- This migration repairs the rows already stored that way, STRICTLY scoped to CAFE24
-- and raw inform_status = 'C':
--   1) correct the canonical status to ANSWERED;
--   2) close the incorrectly-OPEN work item via an AUDITED terminal transition
--      (OPEN -> COMPLETED) — never a hard delete. The Inquiry, the work item, and the
--      full append-only audit trail are all preserved.
-- Idempotent: guarded WHERE clauses + the audit's unique (work_item_id, command_id),
-- so re-running affects zero rows.

-- 1) canonical status repair
update inquiries i
   set status = 'ANSWERED', updated_at = now()
  from channels c
 where i.channel_id = c.id
   and c.code = 'CAFE24'
   and i.inform_status = 'C'
   and i.status <> 'ANSWERED';

-- 2a) append the audited OPEN -> COMPLETED transition (before flipping the phase, so
--     phase_from = OPEN is accurate and the guard still matches the OPEN rows).
insert into inquiry_work_item_audit
      (id, org_id, work_item_id, command_id, event_type, phase_from, phase_to, actor, created_at, updated_at)
select gen_random_uuid(), wi.org_id, wi.id, 'cafe24-c-status-repair:' || wi.id,
       'VERIFICATION_RECORDED', 'OPEN', 'COMPLETED', 'SYSTEM:CAFE24_STATUS_REPAIR', now(), now()
  from inquiry_work_item wi
  join inquiries i on i.id = wi.inquiry_id
  join channels c on c.id = i.channel_id
 where c.code = 'CAFE24'
   and i.inform_status = 'C'
   and wi.phase = 'OPEN'
on conflict (work_item_id, command_id) do nothing;

-- 2b) perform the terminal transition
update inquiry_work_item wi
   set phase = 'COMPLETED', updated_at = now()
  from inquiries i
  join channels c on c.id = i.channel_id
 where wi.inquiry_id = i.id
   and c.code = 'CAFE24'
   and i.inform_status = 'C'
   and wi.phase = 'OPEN';
