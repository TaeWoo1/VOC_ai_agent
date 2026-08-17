-- The raw model answer, beside the tier that survives the additive guard.
--
-- Found by the independent review of candidate B: `AdditiveTriageDecision` was applied in the
-- evaluation harness and NOWHERE ELSE. Every stored prediction stamped `+additive-guard/v1` into
-- classifier_version while `tier` held the model's unguarded answer — a version string asserting a
-- property the row did not have, which is worse than not claiming it.
--
-- tier        — the decision RUBRIC v2 §8.9's invariant produces. This is the one anything downstream
--               may read, and the one a seller would ever be shown.
-- model_tier  — what the model actually said, kept because "did the prompt fix the behaviour, or is
--               the guard carrying it?" is a real question about a candidate, and it becomes
--               unanswerable the moment the raw answer is discarded. Null when the classification
--               failed, which is exactly when the model said nothing.
--
-- Additive, nullable, no backfill: no row predates this column, and inventing a model_tier for one
-- that did would be inventing evidence about a candidate.
alter table review_triage_predictions add column if not exists model_tier varchar(24);

comment on column review_triage_predictions.model_tier is
    'The raw model answer. tier is the guarded decision; these differ exactly where the guard fired.';
