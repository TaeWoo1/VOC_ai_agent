-- Separate historical-backfill progress from routine-collection progress.
--
-- THE DEFECT. `sync_cursors` holds exactly one row per (org, seller account, data type) under the
-- key 'primary', and SyncRunExecutor.runPages wrote the operator's backfill seed into that same row.
-- Nothing ever cleared it. So a one-off "collect 2025-03-23..25" permanently redefined where ROUTINE
-- collection starts: every later scheduled run decoded that window, resumed at the offset the
-- backfill had reached, and swept a closed range in the past. Found live on the demo org's Cafe24
-- account -- INQUIRY parked at `b6:o2:s2025-03-23:e2025-03-25` with an hourly schedule enabled,
-- which is why 3,201 inquiries collected on 2026-07-06 were never re-observed once (3,200 of them
-- still carry created_at = updated_at) and why no reply-status change on any of them could ever
-- land, even though the upsert that would have applied it shipped in V34.
--
-- THE INVARIANT: a historical backfill must never redefine the starting cursor or window of routine
-- collection. Two lanes, two keys, one table: 'primary' is routine, 'backfill' is historical.
--
-- REPAIR. A Cafe24 board-article cursor carries its window in the value itself
-- (`b<board>:o<offset>:s<start>:e<end>` -- Cafe24ArticleCursor). A 'primary' row in that shape is a
-- backfill seed sitting in the routine lane: move the value to the 'backfill' lane and clear the
-- routine one. A cleared routine cursor is not a loss -- it is the honest state ("routine collection
-- has recorded no progress on this board"), and it restores the unbounded offset sweep that was the
-- behaviour before any backfill ran. The sweep is idempotent: the V34 external-id upsert absorbs a
-- re-observed article as an update or a no-op, never a duplicate.
--
-- Deliberately narrow: ORDER_SUMMARY cursors self-window (a date or a JSON envelope) and are NOT
-- backfill seeds, so the pattern below cannot match them. Anything that is not a windowed article
-- cursor is left exactly as it is.

insert into sync_cursors (id, org_id, seller_account_id, channel_id, data_type, cursor_key, cursor_value, created_at, updated_at)
select gen_random_uuid(), c.org_id, c.seller_account_id, c.channel_id, c.data_type, 'backfill', c.cursor_value, now(), now()
  from sync_cursors c
 where c.cursor_key = 'primary'
   and c.cursor_value ~ '^b[0-9]+:o[0-9]+:s[0-9]{4}-[0-9]{2}-[0-9]{2}:e[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   and not exists (
         select 1 from sync_cursors b
          where b.org_id = c.org_id
            and b.seller_account_id is not distinct from c.seller_account_id
            and b.data_type is not distinct from c.data_type
            and b.cursor_key = 'backfill');

update sync_cursors
   set cursor_value = null,
       updated_at = now()
 where cursor_key = 'primary'
   and cursor_value ~ '^b[0-9]+:o[0-9]+:s[0-9]{4}-[0-9]{2}-[0-9]{2}:e[0-9]{4}-[0-9]{2}-[0-9]{2}$';
