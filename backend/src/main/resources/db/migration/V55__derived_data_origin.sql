-- A derived row is only as real as the row it was derived from.
--
-- V54 stopped the operational surfaces counting synthetic reviews, inquiries and order days, but the
-- tables built ON TOP of them kept their own copies of the same verdicts: 60 item_analyses over seeded
-- text ("답변 필요" about a question no customer asked) and customer-memory entries indexed from the
-- same corpus, which is what the 반복 문의 and Agent findings read. Filtering the sources while leaving
-- the derivations visible would have moved the dishonesty one table along rather than removing it.
--
-- Propagated by backfill rather than by a join at read time on purpose. These are polymorphic
-- references with no foreign key — source_id points at either table depending on a discriminator
-- column — so a read-time rule would have to be repeated in every query that touches them and would
-- be exactly as easy to forget as the thing it replaces.

alter table item_analyses           add column if not exists data_origin varchar(20) not null default 'REAL';
alter table customer_memory_entries add column if not exists data_origin varchar(20) not null default 'REAL';

-- Inherit the source's classification. The join is by (discriminator, id) against both source tables;
-- a derivation whose source has since disappeared keeps REAL, because "we cannot see the source" is
-- not evidence that the source was fake — the same reasoning V51 applied to absent inquiries.
update item_analyses a
   set data_origin = s.origin
  from (
        select r.id, r.data_origin::text as origin, 'REVIEW' as kind from reviews r
        union all
        select q.id, q.data_origin::text, 'INQUIRY' from inquiries q
       ) s
 where s.id = a.source_id and s.kind = a.source_type and a.data_origin = 'REAL' and s.origin <> 'REAL';

-- customer_memory_entries.entry_kind uses its own vocabulary; map it onto the source tables.
update customer_memory_entries e
   set data_origin = s.origin
  from (
        select r.id, r.data_origin::text as origin, 'REVIEW' as kind from reviews r
        union all
        select q.id, q.data_origin::text, 'INQUIRY' from inquiries q
       ) s
 where s.id = e.source_id and s.kind = upper(e.entry_kind)
   and e.data_origin = 'REAL' and s.origin <> 'REAL';

comment on column item_analyses.data_origin is
    'Inherited from the analyzed source row. Default reads exclude non-REAL.';
comment on column customer_memory_entries.data_origin is
    'Inherited from the indexed source row. Default reads exclude non-REAL.';
