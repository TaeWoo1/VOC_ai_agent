# R4 Run 4 — Full Export Pilot · Dispatch Record · EXECUTED 2026-07-15 · **COMPLETED — END-TO-END PROVEN**

> **RESULT (2026-07-15): `COMPLETED` 3-of-3 — the full export path is PROVEN LIVE.** The seller's export
> action fired a real download; the Runtime detected it read-only, quarantine-validated it (OOXML sniff), and
> **ingested it to the local dev backend**: `SUCCESS`, **55 rows / 55 succeeded / 0 skipped / 0 failed** (a
> clean first ingest, +55 — not a dedup no-op). Wire filename `aw-<artifactRef>.xlsx` (opaque; the
> platform-suggested filename was never uploaded). No blocker. Full write-up →
> [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-17.
>
> ⚠ **This run MUTATED, as authorized.** 55 real test-seller review rows are now in the **local dev** backend
> DB (`localhost:8080`, never production). **Not reversible by the Runtime.** P6 + export-scoped G6 consumed.
>
> 🔎 **Choreography correction (observed):** the export is a **TWO-step** human action — the highlighted-control
> click opens an **expected NAVER confirmation dialog** the operator must manually confirm; the download only
> fires on that confirmation. See "Click choreography" below.

> **STATUS: DISPATCHED 2026-07-15 — FULL EXPORT PILOT.** Operator seated and gave explicit go; preconditions
> verified and G3/P6/G6/§7 affirmed fresh (below).

## Why this run — prove the one leg §8-16 left open

The §8-14 readiness false-empty is **resolved live** (Run 3, §8-16): `prepareSurface` now reaches the human
barrier on a populated surface. But Run 3 was observe-only — it deliberately did **not** exercise the
click → download → validate → **ingest** legs. Run 4 proves that remaining end-to-end path: that a real
seller export click yields a real download the Runtime detects read-only, validates in quarantine (OOXML
sniff), and ingests to the backend, driving the run to `COMPLETED` (progress 3-of-3).

## Posture — FULL EXPORT PILOT (real click, real download, real ingest)

The Runtime runs `prepareSurface` → `locate` → `highlight` → parks at `WAITING_FOR_HUMAN`; **the seller
performs the real export action on the highlighted control**; the Runtime observes the resulting download
(read-only detection, opaque `artifactRef`), validates it in the gitignored quarantine (extension + OOXML/
ZIP magic sniff; a failed delete fails closed as `ARTIFACT_INVALID`), and **ingests the validated bytes to
the backend `/api/uploads`** under an opaque `aw-<artifactRef>.xlsx` name (the platform-suggested filename is
never uploaded). On success the run reaches `COMPLETED` (progress 3-of-3) and the file exists in the backend.

- **Entrypoint:** `collector/src/cli/run-action-window-live-naver.ts` (gated by
  `--i-understand-this-opens-live-naver`; refuses under `NODE_ENV=production`). `buildLiveRunDeps` wires the
  **real** backend ingest (`buildBackendIngestUpload` → `/api/uploads`, dev creds from `loadConfig`).
- **Choreography note:** after the barrier, `driveOneRun` arms read-only download detection; the seller must
  perform the export click **promptly when prompted** so the real download fires inside the detect window
  (else the run fails closed `DOWNLOAD_TIMEOUT`, non-mutating — the Run-3 shape). One export action only.

**Channel / seller:** NAVER SmartStore review-management export · `NAVER_DEV_SELLER_SELF_01` (operator's own
**test** seller account).
**Invocation (do NOT run yet):** load `.env`, then the gated live-run command with the approval flag.

---

## Preconditions — ☑ VERIFIED at dispatch 2026-07-15

- ☑ **Local dev backend is UP and is the target.** Verified by read-only preflight: `baseUrl` resolves to
  `http://localhost:8080` (`SELLEROPS_BASE_URL` unset → `loadConfig` default; localhost ✓); `java` LISTEN on
  `*:8080`; `GET /health` → **200**; `GET /api/channels` → **401** (Spring Security active — correct for an
  anonymous call; the collector authenticates via `login → resolveChannelId → uploadReviewBytes`). Started
  with `cd backend && ./gradlew bootRun` against the existing local PostgreSQL (`sellerops` DB, already
  Flyway-migrated). **NEVER production** — `NODE_ENV` unset ✓ (the entrypoint also refuses
  `NODE_ENV=production`).
- ☑ **Data understanding:** the export is the operator's own test-seller review data. The file's CONTENT is
  written to the dev backend by design (that is the product's purpose); this is self-owned data on a
  self-owned local dev backend. Sanitized logs/outputs stay enum/bucket-only; the wire filename is opaque
  (`aw-<artifactRef>.xlsx`); the backend result is reduced to `{ ok, processed }` (no content in logs).
- ☑ **Dedup awareness:** re-ingesting the same rows dedups (unique `리뷰글번호`). A zero/near-zero processed
  delta is **dedup, not failure** — interpret the result accordingly rather than retrying blindly.

## Click choreography — evidence-based timing (code + Run 3) · **CORRECTED from Run 4 (observed)**

- `waitForUserAction` uses `observeTimeoutMs` = **10 min**; `detectDownload` uses `downloadTimeoutMs` =
  **60 s** (`DOWNLOAD_TIMEOUT_MS = 60_000`). Run 3 (no click) terminated on `DOWNLOAD_TIMEOUT` ~60 s after the
  barrier — i.e. `driveOneRun` auto-sends `REQUEST_STEP_RECHECK` immediately once the run parks, so **detect
  is listening within ~a second of the highlight appearing**.
- 🔎 **OBSERVED IN RUN 4 — the export action is TWO steps, not one:**
  1. the seller clicks the **highlighted** export control, which opens an **expected NAVER confirmation
     dialog** (a normal part of the SmartStore export flow);
  2. the seller **manually confirms that dialog** — **the real download only fires on this confirmation.**
  The Runtime performs neither step; it only observes. **Both steps must complete inside the ~60 s detect
  window**, so the seller should click AND confirm without hesitation once the highlight appears.
- **Therefore: the seller must act PROMPTLY (click + confirm within ~60 s of the highlight appearing).** A
  late/unconfirmed action ⇒ fail-closed `DOWNLOAD_TIMEOUT`, **non-mutating** (the Run-3 shape) — safe, but it
  consumes the G6 and needs a fresh one to retry.
- No race: detect attaches before any human can physically click, so an early click is not missed.
- **§7 nuance (important):** this export confirmation dialog is **EXPECTED and recognized** — it is part of
  the flow and is **NOT** an abort trigger. §7's "any **unrecognized** prompt/dialog → abort" still stands for
  anything else (2FA/CAPTCHA storms, account/lockout notices, unfamiliar data, or any dialog that is not this
  export confirmation).

## Gates — AFFIRMED FRESH at dispatch (operator/PO, 2026-07-15) · ☑ ALL AFFIRMED

Static carried in: **G1** (D-021 channel) · **G2** (seller self-consent) · **G4** (offline suite green,
incl. the merged readiness fix) · **G5** (policy track). Every earlier G3 lift / P6 / G6 is **consumed**;
the Run-3 lift/P6/G6 were **observe-only** and do **NOT** authorize this mutating run.

### G3 (export + ingest scoped) — environment + §9-3 pause lift · ☑ AFFIRMED 2026-07-15
- ☑ Stable network / IP / location holds.
- ☑ Dedicated Chrome connection profile intact.
- ☑ NAVER live-work pause lifted **for THIS one full export pilot** — scoped to a single real export
  action + download + validate + backend ingest. This IS a click / download / **ingest** lift (broader than
  Run 3's observe-only lift). Not a general/standing lift.

### P6 — supervised full-pilot gate sign-off · ☑ AFFIRMED 2026-07-15 (FULL scope)
- ☑ Signed off for the **full export pilot** — real click → download → validate → **real `/api/uploads`
  ingest** → `COMPLETED`. Explicitly authorizes the irreversible backend write (§4.2). Distinct from the
  Run-3 observe-only P6.

### G6 — per-run approval · ☑ AFFIRMED + CONSUMED 2026-07-15 (fresh, single-use, FULL §4 boundary)
- ☑ Run scope: **live full export pilot** — one real export action, one download, quarantine-validate, one
  backend ingest, terminal `COMPLETED` (or an honest fail-closed). **Mutating.**
- ☑ §7 abort criteria acknowledged (below).
- ☑ G2 / G3 / G5 + preconditions (backend up, data, dedup) affirmed.
- Approved by operator (PO) · Date 2026-07-15 · Single-use — consumed by this launch; **VOID** thereafter.
  Any further live contact needs a **new** G6.

### §7 abort criteria · ☑ ACKNOWLEDGED AT DISPATCH 2026-07-15
- ☑ Operator-immediate: withdrawn consent · any **unrecognized** prompt/dialog · any anti-abuse signal
  (CAPTCHA storm / lockout) · any unexpected on-screen data → the seller aborts (**Ctrl-C**) and does NOT
  click. Before the click, the run is still non-mutating; after a successful ingest it is not reversible by
  the Runtime.
- ☑ If anything is off at the barrier, **do not perform the export action** — abort and re-scope.
- ☑ **Clarified from Run 4 (observed):** NAVER's **export confirmation dialog** raised by the highlighted-
  control click is **EXPECTED and recognized** — confirming it is the intended second half of the seller's
  export action and is **NOT** an abort trigger. The "unrecognized prompt/dialog" rule applies to everything
  else.

---

## Verification plan (what the outcome means)

- **End-to-end CONFIRMED:** `status: COMPLETED` · `progress: { completedSteps: 3, totalSteps: 3 }` ·
  `channelCode: naver`, no blocker. The backend reports an ingest (`{ ok: true, processed: <delta> }`); the
  first-ingest delta is positive (or zero on a re-run — dedup). This proves the full path the readiness fix
  unblocked.
- **Fail-closed (non-mutating) shapes, all honest:** `DOWNLOAD_TIMEOUT` (no/late click — no download
  captured), `ARTIFACT_INVALID` (download failed the quarantine sniff — deleted, not ingested),
  `UNSUPPORTED_STATE` (readiness regressed — would contradict §8-16; re-diagnose). None of these ingest.
- **Ingest failure:** a non-`ok` backend outcome fails the run closed (currently mapped to
  `UNSUPPORTED_STATE`; a dedicated `INGEST_FAILED` code is deferred). Record the sanitized result; do not
  retry blindly.
- Everything logged is sanitized (status / progress / channelCode / blockerCode enums + `{ ok, processed }`
  only). No URL, content, filename, identity, token, or timestamp is emitted.

## Post-run evidence — ☑ RECORDED 2026-07-15

- ☑ **Sanitized terminal result:** `status: COMPLETED` · `progress: { completedSteps: 3, totalSteps: 3 }` ·
  `channelCode: naver` · **no blocker**. Backend ingest: `status: SUCCESS`, **totalRows 55 / successRows 55 /
  skippedRows 0 / failedRows 0** — a clean **first ingest** (+55 delta, not a dedup no-op).
- ☑ **END-TO-END PROVEN LIVE.** The full chain the readiness fix unblocked now works on the real surface:
  `prepareSurface (READY) → locate → highlight → [seller click + confirm dialog] → real download → read-only
  detect → quarantine-validate (OOXML sniff) → real /api/uploads ingest → COMPLETED`.
- ☑ **Privacy posture held under a real file:** the wire filename was the opaque
  `aw-<artifactRef>.xlsx` (`aw-baaef5bcd1b927db.xlsx`) — NAVER's suggested filename was never uploaded. The
  Action Window view emitted only `status` / `progress` / `channelCode` (no content, no blocker).
- ☑ **Quarantine emptied post-ingest** — the temporary real export file was validated then **deleted**, per
  the ratified D-021 posture.
- ☑ **Choreography finding (feeds future runs + §7):** the export is a **two-step** human action — the
  highlighted-control click raises an **expected NAVER confirmation dialog** the operator must manually
  confirm, and **the download fires only on that confirmation**. Both steps must land inside the ~60 s detect
  window. The dialog is **expected/recognized** and is **not** an abort trigger (see Click choreography + §7).
- ☑ **MUTATION (as authorized):** 55 real test-seller review rows are now in the **local dev** backend DB
  (`localhost:8080`, never production). **Not reversible by the Runtime.**
- ☑ **Teardown clean:** `.aw-quarantine/` empty, no `downloads/`, sentinel auto-removed (`.status/` empty),
  browser closed, process exited (code 0), git worktree clean.
- ☑ **P6 + export-scoped G6 consumed** (single-use, spent). Any further live contact needs **new** ones.
- ☑ **Recorded** in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-17; §6 / current-state updated.

## Follow-up — RESOLVED 2026-07-15 (offline slice)

- ~~The `upload.done` dev log line carries **exact row counts** + the opaque filename.~~ **Closed.** The log
  now carries the backend status enum + four coarse `RowCountBucket`s and **no filename**; the sibling
  `item-analysis.count` is bucketed too. Both functions still **return** exact counts to their callers — only
  the log is narrowed. Offline-verified; **no live re-run needed** and this run's `COMPLETED` result stands.
- **Two corrections to the note above, for the record:**
  1. The binding rule is **`collector/CLAUDE.md` §4 item 3**, not "§3" (which is this file's G1–G6 gate
     section). §4 item 4 explicitly names "log" as a bound surface, so the rule did apply.
  2. **"the opaque filename" was wrong.** It is opaque only on the Action Window path
     (`neutralUploadName(artifactRef)` → `aw-<hex>.xlsx`, which is what this run used). The `uploadReviewFile`
     wrapper passes `basename(filePath)`, so the capture / diagnostic / manual CLIs were logging a **real
     seller-center export basename** — arguably a sharper concern than the counts, now dropped.
- Nothing leaked on the wire at any point: `upload.done` is a dev log, not a contract event, and the
  sanitization boundary (`{ ok, processed }`) sits downstream of it. See [`r4-evidence-pack.md`](r4-evidence-pack.md)
  §8-17 for the full write-up.
