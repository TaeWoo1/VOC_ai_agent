# review-issue-validation — the only proof that V31 and the judgements agree

Operator-run. No live contact, no NAVER, no Chrome, no marketplace network, no secrets.

> ## ⚠ What a green run does NOT mean
>
> This harness checks **behaviour**, not detection quality. A 45/45 run says the judgements fire in
> the windows the contract defines, the suppression rules hold, re-runs are idempotent, and the
> needs-a-look queue does not move. It says **nothing** about whether the issues are the right issues.
>
> The extractor's accuracy is **unmeasured**: `contracts/review-eval/naver/v1/labels.json` is empty, so
> the bars in that rubric (precision ≥ 0.80 Wilson lower bound, recall ≥ 0.30, high-rating false
> positives ≤ 0.05) have never been evaluated against anything. The thresholds in
> `contracts/review-issue/v1/THRESHOLDS.md` are a **DRAFT** awaiting product-owner confirmation.
>
> Do not quote a passing run as evidence that repeated-VOC detection works.

```bash
bash tools/review-issue-validation/run-synthetic.sh
```

Requires local Postgres, JDK 17 + Gradle, node 20+. Takes about a minute, most of it the backend boot.

## Why this exists rather than a JUnit test

Two things the JVM suite structurally cannot check:

1. **The migration.** `application-test.properties` runs H2 with `spring.flyway.enabled=false` and
   builds the schema from the entities, so `V31__review_issue_memory.sql` is never executed there. A
   migration that disagreed with the entities would be green in `./gradlew test` and break on the
   first real deploy. This harness boots a real backend against a real Postgres database, then asserts
   `flyway_schema_history` recorded version 31 as successful and that all four tables and their
   indexes exist.
2. **The judgements end to end.** `IssueChangeRulesTest` proves the arithmetic on hand-built
   snapshots. It cannot prove that the queries which build those snapshots select the right rows —
   window boundaries, the non-overlapping baseline, per-product grouping that excludes unattributed
   rows. Only real SQL over real dates does that.

## What the run proves

The corpus is deliberately two-part:

- **The committed golden NAVER export** (`contracts/review-export/naver/v1`), ingested through the
  same `/api/uploads` path a live export uses, so the ingest leg is real rather than hand-built.
- **A synthetic 5★ corpus** (`synthetic-corpus.mjs`) whose dates place each judgement in the window
  `contracts/review-issue/v1/THRESHOLDS.md` defines for it.

**Every synthetic row is rated 5, and that is the point.** The shipped analyzer derives sentiment and
urgency from `rating`, so a 5★ review complaining about delivery is invisible to the needs-a-look
queue. A corpus of 5★ complaints therefore proves two things in one run:

- issues and change judgements appear from reviews the queue cannot see, and
- the queue's own `LOW_RATING_REVIEW` count **does not move** — the regression gate in
  `contracts/review-eval/naver/v1/RUBRIC.md` §5, which says a detector may only ADD.

That gate is asserted with a **non-zero baseline** (2, matching the golden export's committed
`expectedAttention`). Without that floor the gate would pass by comparing zero to zero — the same
vacuous-check failure the concentration minimum in THRESHOLDS.md §2.4 exists to prevent. It was
exactly that vacuous at first, because the attention DTO's field is `items` and the verifier read
`signals`.

Beyond those, the run covers: all four judgements firing in their own windows; PERSISTENT suppressed
by SURGING and CONCENTRATED overlapping with it on real data; extraction idempotency (a re-run adds
nothing, because the import path is resumable and the same review legitimately arrives twice);
IMPROVED never raising an issue for review; the lifecycle pass being idempotent per reference date;
the operator path 확인 필요 → 조치 중 → 개선 확인 중 with state-skipping refused; **an issue that went
quiet without recorded remediation NOT being resolved**; 개선 확인 중 → 해결됨 only after the quiet
weeks; masked quotes never exceeding the preview length; dismissal surviving a re-extraction rather
than becoming a recurring nag.

## Safety

- The disposable database is named `sellerops_issueproof_<UTC stamp>` and `guarded_dropdb` **refuses
  any name without that prefix**. The run falsifies the guard against `sellerops` and `sellerops_dev`
  before it does anything else, and prints the surviving `sellerops*` databases at teardown so the
  persistent one is visibly intact.
- Teardown runs from an `EXIT` trap, so a failed assertion still drops the database and kills the
  backend.
- Nothing here is in CI. See `docs/ci-coverage.md` — a CI job that could create and drop databases and
  boot a backend is operator-run by design, and its name-guarded teardown assumes a human is watching.

## Fixed reference date

`REF=2026-07-25`, with the synthetic corpus generated backwards from it. A run is therefore
reproducible months later, and `synthetic-corpus.mjs` reads no clock. If you change `REF`, change
nothing else — every window is relative.
