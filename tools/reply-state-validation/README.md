# Reply-State Live Validation

Proves the review reply-state guarantees on **real ingested data**, not synthetic fixtures:

- **C2** — a review the channel already answered leaves the **actionable low-rating queue** while staying
  visible as a `NEW_REVIEW` arrival; **pending** low-rating reviews stay actionable (so the check cannot
  pass by excluding everything).
- **C4** — starting a **guided reply** for an already-answered review is **refused server-side** (409 on
  the answered gate). Proven answer-**specific**: a pending review taken through the same step is refused
  *later* (on the approval gate), not on the answered gate.

The exclusion/refusal code already ships (`review-reply-state-v1`). This package is a **live validation**:
prove those behaviors on data that arrived through the real export→ingest path, plus evidence and docs.

## Pieces

- **`verify.mjs`** — the reusable, **data-driven, source-agnostic** C2/C4 harness. It reads whatever
  reviews exist for one single-NAVER-account org and asserts C2/C4 on them. It does **not** know or care
  whether the reviews came from a synthetic seed or a live export — so the synthetic seed can be swapped
  for the live-export ingest result **without changing the verification logic**. Output is sanitized
  (counts + booleans only — no review bodies, reviewer/order identity, or raw messages). Exit 0 iff all
  checks pass.
- **`run-synthetic.sh`** — the offline synthetic proof: fresh disposable backend → single-NAVER-account
  org → seller-account resolution pinned → seed the **committed golden export** through the same upload
  path a live export uses → `verify.mjs` → **guarded teardown** (name-guarded drop, no persistent data).

## Run the synthetic proof (no live contact)

```bash
bash tools/reply-state-validation/run-synthetic.sh
```

Requires local Postgres, the backend (JDK/Gradle), node, and installed collector deps. It boots its own
disposable backend on `SERVER_PORT=18080`, so nothing else may hold that port.

## The live proof (gated — do NOT run without approval)

Same harness, real data. It needs a **fresh single-use G3 + G6** and explicit **"seated and ready"**
(per-run, in the dispatching turn) before any live contact — see `docs/action-window-runtime/`. The only
change from the synthetic run is the **seed step**: instead of uploading the golden export, the operator
performs one live NAVER export (the known suitable scope — a range with ≥1 answered and ≥1 pending
low-rating review) which **ingests** into the disposable backend; then `verify.mjs` runs **unchanged**.

Bounds carried over: **no public reply**, the reply-submission approval flag is never passed (C4 is a
refusal + a backend-only contrast — nothing is submitted to NAVER), and a **guarded teardown** leaves no
persistent data.

## Completion criteria (this package)

Real answered-review reply-state preserved · C2 answered excluded from the actionable queue · C4
reply-prep refused for an already-answered review · no public reply · clean teardown. One PR at completion.
