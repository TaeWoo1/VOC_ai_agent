# NAVER Initial Review Import — validation

Offline proof of the V1 Initial Review Import mechanics, mirroring the reply-state validation harness.

Two harnesses, because there are two paths and they are not equal:

| script | path it proves |
|---|---|
| `run-guided-synthetic.sh` | the **product** path — one seller click authorizes one guided Action Window run, and the download is ingested into the segment its ticket is bound to |
| `run-synthetic.sh` | the **fallback** path — an operator supplies a file for a segment themselves |

## `run-guided-synthetic.sh`

Drives the real launch APIs on a fresh disposable backend (port `18083`), standing in for the
local-agent runtime — the only thing a live run adds is opening Chrome and guiding the seller.

```bash
bash tools/review-import-validation/run-guided-synthetic.sh
```

It proves, in one pass:

- **discovery first** — a discovery ticket is issued with no plan, because the plan is built from
  whatever range the marketplace turns out to allow;
- **identity-free resolve** — what the runtime is told carries no plan / segment / account id;
- **plan from the discovered range** — reporting the range creates the plan and its month segments;
- **single use** — a spent ticket cannot be replayed, for discovery or for ingest (HTTP 409), and a
  replay creates no second plan;
- **automatic segment ingest** — the file lands in the bound segment (COMPLETED + COVERED) with the
  attempt linked to its own sync job;
- **evidence is recorded, not assumed** — an `OPERATOR_CONFIRMED` run is stored as exactly that and
  never upgraded to a machine match;
- **re-click idempotency** — asking twice returns the *same* authorization, so one segment can never be
  driven by two concurrent runs;
- **overlap-safe dedup** on the guided path (the same export into the next segment ⇒ 0 new);
- **resume** — after an interruption the next authorization is for the next *remaining* segment;
- **coverage / health / MISSING**, ending with the plan COMPLETED and a further authorization refused
  rather than invented.

Because the backend boots for real here, this also exercises the V28 migration under Flyway — the JVM
test suite runs H2 with Flyway disabled and cannot.

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
(name-guarded at teardown). The segment date ranges are the plan's, not the golden file's — on this path
scope matching is the operator's attestation (`scopeConfirmed=true` here), which is why it is the fallback:
it has no read-back of what was actually exported.

## Live proof (seated, gated)

The bounded live proof runs the guided flow through the operator-driven NAVER Action Window on a fresh
disposable backend: range discovery, plan creation, then at least two adjacent segments with automatic
download detection and segment ingest. It needs a fresh single-use G3/G6 and a `segment N go` confirmation
before each export, so it is not scripted here — it is a seated campaign, recorded in the runtime docs.

Neither harness can substitute for it, and neither claims to: they prove the orchestration, while the live
run is what proves the guidance actually lands on NAVER's real controls.
