-- Issue Evidence Trust Closure v1 (2026-09-04): evidence that a synthetic review wrote is not evidence.
--
-- The extractor used to read whatever `findForIssueExtraction` returned, and outside a web request the
-- realDataOnly filter is not enabled — so DEMO_SEED and VERIFY_FIXTURE reviews became rows in
-- review_issue_evidence (measured on the Demo Org: 11 seeded + 1 fixture rows, most of them the
-- 「접착 탈락」 issue's count). Read-side excludes those reviews, which is exactly why the rows were
-- invisible: the issue counted them and could not show them. The write side now refuses synthetic
-- reviews (ReviewIssueExtractionService); this repairs what was written before that.
--
-- Same shape as V93's cascade: the predicate is the review's own provenance, never a pattern, and
-- an issue that loses rows keeps its identity and lifecycle — only its span is re-derived.

delete from review_issue_evidence e
 using reviews r
 where r.id = e.review_id
   and r.data_origin <> 'REAL';

delete from review_issue_unknown_units u
 using reviews r
 where r.id = u.review_id
   and r.data_origin <> 'REAL';

update review_issues i
   set first_evidence_on = s.first_on,
       last_evidence_on  = s.last_on
  from (select issue_id, min(occurred_on) as first_on, max(occurred_on) as last_on
          from review_issue_evidence
         group by issue_id) s
 where s.issue_id = i.id;

update review_issues i
   set first_evidence_on = null,
       last_evidence_on  = null
 where not exists (select 1 from review_issue_evidence e where e.issue_id = i.id);
