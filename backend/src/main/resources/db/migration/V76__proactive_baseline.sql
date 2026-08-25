-- Proactive Operations Agent v1 — the per-org activation baseline (2026-08-25)
--
-- ONE nullable column, on the org it belongs to.
--
-- An audit for somewhere better to put it came back empty: this repository has no org-settings and no
-- per-org feature-flag persistence at all — `organizations` carries a name and nothing else. Creating
-- a settings subsystem to hold one timestamp would be more architecture than the value is worth, and
-- a watermark table is explicitly not what this needs: there is no cursor to advance, no progress to
-- resume, and nothing to reconcile. There is one moment per org, written once.
--
-- WHAT IT MEANS: the instant this org's proactive loop was activated. Work SellerOps first observed
-- BEFORE it is historical bootstrap backlog and can never become a proactive candidate; work first
-- observed at or after it can. The column being NULL means "not activated", and an org with no
-- baseline prepares nothing — the same fail-closed posture the config boundary had before it.
--
-- WHY IT IS NOT A CONFIG VALUE ANY MORE: a boundary chosen for one bootstrap audit is not a product
-- contract, and an env var makes "when was this org activated" a fact about a deployment rather than
-- about the org. It is also what made the value re-typable, and a re-typed boundary is a re-opened
-- flood.
--
-- WHO WRITES IT: the reconciler, exactly once, on the first tick it runs for an org that has none —
-- activation IS the baseline, so there is nothing for an operator to set and nothing to get wrong.
alter table organizations add column if not exists proactive_baseline_at timestamptz;

comment on column organizations.proactive_baseline_at is
  'Proactive Operations Agent activation instant. Source signals first observed before it are historical bootstrap backlog and are never proactive candidates. Null = not activated. Written once, by the reconciler.';
