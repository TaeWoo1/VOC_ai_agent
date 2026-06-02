# brand20_backfill fixtures

Synthetic `batch_summary.json` payloads used by
`tests/test_app/test_backfill_brand20_queue_from_artifacts.py` to
exercise the historical-backfill scanner without touching real
collection artifacts under `data/collection_artifacts/` or the
production seed at `ops/brand20_collection_queue.json`.

Each fixture is shaped to exercise one classification path:

- `done_complete_*.json` — clean terminal: final_status=complete,
  no 429 signals, pagination_exhausted=True. Classifier: `done`.
- `retry_429_*.json` — cursor_api_rate_limited=True with parsed
  count varying for tie-break tests. Classifier: `retryable_429_partial`.
- `local_cap_primary.json` / `local_cap_signal.json` — connector
  hit `max_cap_reached` cleanly. Primary vs signal target_type is
  set on the QUEUE side; the summary itself is the same shape.
- `manual_required_*.json` — retry_intent=manual_review_required.
  Classifier: `manual_required`.
- `unknown_sort.json` — carries a sort_type not in the canonical
  5-sort taxonomy; scanner drops with a verbose log.

The corresponding queue fixtures are built inline in the test file
via `tmp_path` so the production seed is never read or modified.
