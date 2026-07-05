-- Cafe24 native product inquiries (board 6 문의사항) now route into the common inquiry
-- work queue (Inquiry + one OPEN InquiryWorkItem), the same channel-neutral path ESM
-- uses, so the channel catalog must advertise CAFE24 as inquiry-readable.
--
-- The channel catalog rows are inserted at first startup by MockDataSeeder (which is
-- updated in the same change so fresh databases seed CAFE24 with supports_inquiry =
-- true). This migration corrects an ALREADY-persisted catalog where CAFE24 was stored
-- with supports_inquiry = false. Insertion stays the seeder's responsibility — this is
-- an UPDATE only, so on a not-yet-seeded (empty) database it matches 0 rows and the
-- seeder then inserts the row with the corrected value. Board 4 reviews and the
-- read-only / no-reply-write posture are unchanged; this flag is a catalog badge only.
update channels
   set supports_inquiry = true,
       updated_at = now()
 where code = 'CAFE24'
   and supports_inquiry = false;
