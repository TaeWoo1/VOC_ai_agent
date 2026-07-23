-- A reported reply may have had NO Action Window run behind it.
--
-- `aw_run_ref` was `not null`, which forced the client to supply one for every outcome. In every
-- shipped build the guided runtime was the SIMULATED one, so what production actually stored was a
-- locally-minted `run_<hex>` for a run that never happened: a fabricated Action Window identity,
-- indistinguishable in the table from a real one.
--
-- NULL now means exactly "no Action Window run backed this report" — the manual copy-and-post
-- handoff, which is the only honest path when Bridge guidance is unavailable. A non-null value keeps
-- its original meaning: the opaque runId a real guided post ran under.
--
-- Additive and reversible in effect: every existing row keeps its value, and nothing reads the
-- column as a presence test today. Not CONCURRENTLY — dropping a NOT NULL takes a brief ACCESS
-- EXCLUSIVE lock and rewrites no rows, and the table is small.
alter table review_reply_outcome alter column aw_run_ref drop not null;

comment on column review_reply_outcome.aw_run_ref is
    'Opaque Action Window runId a guided post ran under, or NULL when the operator posted manually '
    'with no guided run. Never an account id, never page content. NULL is a fact, not a gap: '
    'production may not mint a run identity for a run that did not happen.';
