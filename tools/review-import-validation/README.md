# NAVER Initial Review Import — validation

Offline proof of the V1 Initial Review Import mechanics, mirroring the reply-state validation harness.

## `run-synthetic.sh`

Stands up a fresh disposable backend and drives the **real** import APIs end to end against the committed
golden NAVER export, then tears down guarded (no persistent test data):

```bash
bash tools/review-import-validation/run-synthetic.sh
```

It proves, in one pass:

- a multi-month plan divides into **calendar-month segments**;
- importing a segment lands its rows (**COMPLETED + COVERED**);
- the same export into a second segment is **overlap-safe deduped** (0 new, all duplicate);
- **interruption + resume** — a re-read shows the remaining segment, state persisted;
- the **health** surface (new / duplicate counts, next recommended import);
- a segment concluded unreachable reads **COMPLETED + MISSING** and the plan completes;
- an unattempted segment **splits** into contiguous children, the parent superseded (kept for history).

Requires local Postgres, JDK/Gradle, node, curl. Uses port `18082` and a `sellerops_riv_*` disposable DB
(name-guarded at teardown). The segment date ranges are the plan's, not the golden file's — scope matching
is the operator's confirmed responsibility on the live path (`scopeConfirmed=true` here).

## Live proof (seated, gated)

The bounded **two-segment live proof** runs the same flow through the operator-driven NAVER Action Window
on a fresh disposable backend, under a fresh single-use G3/G6 with a `segment N go` confirmation before each
export. It is not scripted here — it is a seated campaign, recorded in the runtime docs.
