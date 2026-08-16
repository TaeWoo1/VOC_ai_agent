# review-triage-calibration — the labeling session, and nothing else

Operator-run, local only. No live contact, no marketplace, no secrets, and no network except the one
file that is deliberately handed to a second person.

Its job is to let two people answer one question about 220 real reviews, to measure how much they
agreed before anyone reconciles anything, and to make sure the only things that survive in the
repository are their judgments.

The contract it implements is `contracts/review-eval/naver/v2/RUBRIC.md`, written and committed
**before** the sample was drawn. Read it first — the numbers this tooling produces mean nothing
without it, and §7 is the protocol these commands carry out.

## The two rules

1. **Review text stays here**, except for one file built by one explicit command (step 3). The
   worksheet directory is gitignored; `derive-labels.mjs` is the only writer of the committed files;
   it copies four fields and refuses on anything else rather than dropping it quietly.
2. **No labeler is shown a prediction.** Not the rule's tier, not a model's guess, not a "suggested"
   anything. `self-check.mjs` asserts that on the generated page rather than trusting the comment.

## 0. Check the tooling

```bash
node --test tools/review-triage-calibration/self-check.mjs
```

Before a session, not after.

## 1. Draw

```bash
REVIEW_CAL_DB_URL='postgresql://USER@localhost:5432/sellerops' \
  node tools/review-triage-calibration/draw-sample.mjs
```

No default URL: this reads real review text, so the database has to be named on purpose. Prints
counts only — never a body, an id, or a fingerprint.

Three draws, each a pure function of the review ids, so re-running reproduces all three and no list
of drawn rows is stored anywhere: the 220-row sample, 24 calibration rows from **outside** it, and
the 30 overlap rows **inside** it.

Writes `worksheet/owner.html` and `worksheet/rows.json`. **Gitignored — never commit anything under
`worksheet/`.**

## 2. The owner labels 54 rows

Open `worksheet/owner.html`. First 24 (`C1`–`C24`) are outside the sample and become the worked
examples; the next 30 are inside it and the annotator will label the same rows independently.

Keys: `1`–`4` tier, `a`–`v` reason, `q`–`o` 태그, `Enter` next, `Backspace` back. Progress lives in
the browser, so this can be done in sittings. Finish with **라벨 파일 저장**.

## 3. Build the annotator's package

```bash
node tools/review-triage-calibration/build-annotator-package.mjs ~/Downloads/owner-labels.json
```

A separate command because this is the moment real customer prose travels to a second person, and
that should be something someone typed. It carries body, star rating, an opaque row number, the
rubric and the worked examples — and no product, date, review id, fingerprint, seller, channel,
stratum or split. The row number maps to nothing off this machine.

It **fails closed** on a body that looks like it carries a direct identifier, writing those rows to
`worksheet/withheld.html` for the owner instead. Hand over `worksheet/package/annotator.html` and
nothing else.

## 4. The annotator labels all 220

Same page, opened from disk on their machine. They return `annotator-labels.json`.

## 5. Agreement — before any reconciliation

```bash
node tools/review-triage-calibration/agreement.mjs \
  ~/Downloads/owner-labels.json ~/Downloads/annotator-labels.json
```

Prints raw agreement, three-class κ and the decisive binary κ against the pre-committed 0.60 bar,
and writes the owner's `worksheet/adjudication.html` for the rows they differed on. Running this
after adjudication would score the overlap against a label the owner wrote while looking at it, so
it runs first, always.

## 6. Adjudicate, then assemble

```bash
node tools/review-triage-calibration/derive-labels.mjs \
  --annotator ~/Downloads/annotator-labels.json \
  --owner ~/Downloads/owner-labels.json \
  --adjudication ~/Downloads/adjudication-labels.json \
  [--withheld ~/Downloads/withheld-labels.json]
```

Writes `contracts/review-eval/naver/v2/labels.json` and `agreement.json`. Those two get committed;
nothing else does. An unresolved disagreement is an error, not a coin flip.

## 7. Measure

```bash
cd backend && RUN_REVIEW_EVAL=true \
REVIEW_EVAL_JDBC_URL='jdbc:postgresql://localhost:5432/sellerops' \
REVIEW_EVAL_DB_USER=... REVIEW_EVAL_DB_PASSWORD=... \
  ./gradlew cleanTest test --tests '*ReviewTriageEvalIT' -i
```

Gated like `ReviewAnalyzerEvalIT`: it reads real bodies from a local database, so it never runs in CI
and never by accident, and prints counts and rates only.

**It prints `DEV` and withholds `HOLDOUT`.** The person designing the rule is the person running the
harness, so §6.2's "read once" needs a mechanism. When the candidate is final, and once:

```bash
REVIEW_EVAL_SPEND_HOLDOUT=true ...
```

## What a number from this does NOT mean

It is measured on **NAVER export** reviews, the only real review corpus stored here — the 22 Coupang
rows are `MockDataSeeder` output. The tier rule is channel-independent; the numbers are NAVER's.

And 190 of the 220 gold labels rest on a single annotator, with the overlap κ as the only evidence
for them. That κ is measured on a positive-enriched subset of 30 rows, so it is neither precise nor
the corpus-wide agreement. Quote it beside every number that depends on it.
