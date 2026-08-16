# review-triage-calibration — the labeling session, and nothing else

Operator-run, local only. No live contact, no marketplace, no network, no secrets.

Its job is to let a human answer one question about 220 real reviews, and to make sure the only thing
that survives that session in the repository is the human's judgment.

The contract it implements is `contracts/review-eval/naver/v2/RUBRIC.md`, which was written and
committed **before** the sample was drawn. Read it first — the numbers this tooling produces mean
nothing without it.

## The one rule

**Review text never leaves this machine.** The worksheet holds real customer prose and is
gitignored. `derive-labels.mjs` is the only writer of the committed file, it copies four fields, and
it refuses on any field outside the schema rather than dropping it quietly.

## 1. Draw the sample and build the worksheet

```bash
REVIEW_CAL_DB_URL='postgresql://USER@localhost:5432/sellerops' \
  node tools/review-triage-calibration/draw-sample.mjs
```

There is deliberately no default URL: this reads real review text, so the database has to be named on
purpose. It prints counts only — never a body, an id, or a fingerprint.

The draw is a pure function of the review ids, so re-running reproduces the same 220 rows and no list
of drawn reviews is stored anywhere.

Writes `tools/review-triage-calibration/worksheet/worksheet.html` — **gitignored, never commit it.**

## 2. Label

Open `worksheet.html` in a browser. One review at a time, showing the body and the star rating, and
**not** showing what `ReviewTriageRules` concludes — a labeler who has seen the rule's answer is
agreeing or disagreeing with it, which is a different measurement from the one the contract needs.

Keys: `1`–`4` tier, `a`–`v` reason, `q`–`o` issue tags, `Enter` next, `Backspace` back. Progress is
kept in the browser's local storage, so it survives a closed tab and the session can be done in
sittings.

When finished, press **라벨 파일 저장** to download `labels-local.json`.

## 3. Derive the committable file

```bash
node tools/review-triage-calibration/derive-labels.mjs ~/Downloads/labels-local.json
```

Writes `contracts/review-eval/naver/v2/labels.json`. That file — fingerprints and closed-vocabulary
judgments — is what gets committed. The worksheet and the downloaded file do not.

## 4. Measure

```bash
RUN_REVIEW_EVAL=true \
REVIEW_EVAL_JDBC_URL='jdbc:postgresql://localhost:5432/sellerops' \
REVIEW_EVAL_DB_USER=... REVIEW_EVAL_DB_PASSWORD=... \
  ./gradlew :test --tests '*ReviewTriageEvalIT' --info
```

Gated the same way `ReviewAnalyzerEvalIT` is: it reads real bodies out of a local database, so it
never runs in CI and never runs by accident, and it prints counts and rates only.

## What a number from this does NOT mean

It is measured on **NAVER export** reviews, because that is the only real review corpus stored here —
the 22 Coupang rows are `MockDataSeeder` output. The tier rule is channel-independent; the numbers
are NAVER's. Any claim about Coupang has to say so.
