# Local uncommitted-work inventory — ESM REVIEW + Connector Sync State

> **Purpose:** a resume-without-chat-context snapshot of the current local working
> tree, organized by meaningful feature slice. **Inventory only** — no
> implementation, no live browser, no marketplace access, no git operations. All
> file paths below are repo source paths (not marketplace data). Snapshot date:
> 2026-06-30.

---

## 1. ESM REVIEW discovery status

The ESM+ REVIEW seller-center export is being characterized through a gated,
approval-per-step, offline-first **Gate 0–4** ladder
(`docs/esmplus-review-export-discovery.md`). Current state:

- **Gate 2 — done.** A no-click frame-aware classifier located the actionable
  export control inside a cross-origin **allowlisted vendor frame**.
- **TTL keep-open probe — done.** One logged-in context with periodic no-click
  reads stayed `LOGGED_IN` through **T0 / T+120m / T+190m / T+240m** (survived
  ~T+4h), supporting an internal **~2h** sync cadence for browser-export channels.
- **Gate 3 — done (live, supervised).** Exactly **one** human-approved click on
  the single allowlisted-frame export control fired **one** download, which passed
  **structural OOXML/ZIP validation** and was **deleted after validation**
  (observe-and-discard). Result was `CAPTURED_VALID`; nothing uploaded/retained.
- **Gate 4 schema-shape inspector — implemented (offline).** A pure summarizer +
  dependency-free xlsx reader read **workbook structure + the header row only**
  (never a data cell); headers surface as **hash + category** metadata.
- **Gate 4 capture→inspect→delete wiring — implemented (offline, green).** An
  opt-in `--inspect-schema-shape` flag on the Gate 3 capture CLI runs the inspector
  as a **pre-delete hook** (only on a structurally valid xlsx), before the
  delete-in-`finally`.
- **Gate 4 live schema-shape run — deferred.** Intentionally not run, because the
  current IP/environment is **not stable** for live ESM testing.
- **Capability:** **REVIEW remains `NEEDS_DISCOVERY`; nothing is `CONFIRMED`.**
  `schemaMappingConfirmed:false`, `dedupKeyConfirmed:false`.

A stray/background live capture command did fire once but **failed closed on
sentinel-timeout** (clicked: 0, downloaded: 0, no artifacts) — no effect; not
re-launched.

---

## 2. ESM-related local files by slice

> Status legend: **M** = modified tracked file, **??** = new untracked file.

**Gate 3 capture implementation**
- `src/cli/capture-esm-review.ts` *(??)* — supervised one-click/one-download
  capture CLI (live-approval flag + required `--approved-index`; observe-and-discard).
- `src/esm/esm-capture-gate.ts` *(??)* — pure decision core + `CaptureStop` union
  (incl. Gate-4 `schema-inspect-failed` / `delete-failed`).
- `src/naver/review-download-save.ts` *(M)* — shared save module; made generic with
  a pre-delete `inspectFn<R>` hook + observable `deleteFailed` (parser-free, ESM-decoupled).
- Tests: `test/cli/capture-esm-review.test.ts` *(??)*, `test/esm/esm-capture-gate.test.ts` *(??)*,
  `test/naver/review-download-save.test.ts` *(M)*, `test/naver/review-usage-confirm.test.ts` *(M, fixture)*.

**Shared live no-click scan refactor**
- `src/esm/esm-review-live-scan.ts` *(??)* — shared frame-aware no-click scan used by
  the classify/capture paths.
- `src/cli/classify-esm-review.ts` *(M)* — Gate 2 no-click classifier CLI.
- Tests: `test/esm/esm-review-live-scan.test.ts` *(??)*, `test/cli/classify-esm-review.test.ts` *(M)*.

**TTL keep-open probe**
- `src/cli/probe-esm-session-ttl.ts` *(??)* — read-only keep-open session-TTL probe CLI.
- `src/esm/esm-ttl-schedule.ts` *(??)* — pure TTL checkpoint-schedule logic.
- Tests: `test/cli/probe-esm-session-ttl.test.ts` *(??)*, `test/esm/esm-ttl-schedule.test.ts` *(??)*.

**Gate 4 schema-shape inspector**
- `src/esm/esm-review-schema-shape.ts` *(??)* — pure summarizer (risk-first header
  categorization, salt-hashed header meta, row bucket, dedup candidates).
- `src/esm/esm-review-xlsx-reader.ts` *(??)* — dependency-free ZIP+XML reader
  (`node:zlib`); reads sheet/row/column shape + header row only.
- `src/cli/inspect-esm-review-xlsx.ts` *(??)* — offline CLI over an explicit local xlsx path.
- Tests: `test/esm/esm-review-schema-shape.test.ts` *(??)*, `test/esm/esm-review-xlsx-reader.test.ts` *(??)*,
  `test/cli/inspect-esm-review-xlsx.test.ts` *(??)*.

**Capture→inspect→delete wiring** — the opt-in `--inspect-schema-shape` flag spans
the Gate 3 capture CLI + the shared save module (files listed under "Gate 3" and
"schema-shape inspector" above); no separate module.

**Discovery docs**
- `docs/esmplus-review-export-discovery.md` *(M)* — the Gate 0–4 ladder, all live
  results (Gate 2 runs, Gate 3, TTL probe), and Gate 4 implementation/wiring notes.

**Build script** — `package.json` *(M)*: added `tsx` script entries
`capture-esm-review`, `probe-esm-session-ttl`, `inspect-esm-review-xlsx`. **`package-lock.json` unchanged.**

---

## 3. Connector Sync State offline core

A channel-agnostic (NAVER / ESM+ / Cafe24 / future) sync-state model, built as
**pure logic, end-to-end, no I/O**. Flow: existing status → `SyncOutcome` →
`ConnectorSyncState` → dashboard fields.

- `docs/connector-sync-state-model.md` *(??)* — design note (§1–§10) + §11
  implementation-status record.
- `src/connection/sync-state.ts` *(??)* — **types**: the field set + enums
  (`CommerceChannel`, `ConnectorType`, `CapabilityStatus`, `AuthStatus`,
  `SyncStatus`, `SyncErrorCategory`, `DataFreshnessLevel`, `SanitizedAccountRef`,
  `UserReportSchedule`, `ConnectorSyncState`).
- `src/connection/sync-state-derive.ts` *(??)* — **derivations**:
  `deriveNextSyncAt` (internal cadence only), `deriveDataFreshnessLevel`,
  `deriveStaleDataWarning`, `deriveReconnectRequired`, `deriveConnectorDashboardState`
  (manual ISO parse/format — no `Date.*`).
- `src/connection/sync-state-reduce.ts` *(??)* — **reducer**:
  `applySyncOutcome(state, outcome, now, policy?)` → new state; only `SUCCEEDED`
  advances the snapshot anchor.
- `src/connection/sync-outcome-bridge.ts` *(??)* — **read-only bridge**:
  `mapCollectorStateToSyncOutcome` / `mapConnectionStatusToSyncOutcome` (type-only
  imports of existing status enums; never writes, never calls the reducer).
- Tests *(all ??)*: `test/connection/sync-state.test.ts`,
  `test/connection/sync-state-derive.test.ts`,
  `test/connection/sync-state-reduce.test.ts`,
  `test/connection/sync-outcome-bridge.test.ts`.
- **All pure, no I/O** — no DB, API, browser, upload, status write, scheduler, or
  `manualSync`; existing `src/status.ts` runtime untouched.

---

## 4. Verification status

Latest known full run (after the last code slice; the subsequent doc-only edits did
not change tests):

- `npm run typecheck` → **clean**.
- `npm test` → **87 files, 1626 passed, 1 skipped**.
- `git diff --check` → **clean**.
- `package-lock.json` → **unchanged**. `package.json` modified (3 `tsx` scripts only).
- **Nothing staged** (0 staged files).
- **Live ESM paused** — no live browser/marketplace work pending or in progress.

Untracked `tools/` (`../tools/`) exists and is **never staged**.

---

## 5. Deferred work

Each is its own separately-approved future slice — none started:

- **Gate 4 live capture→inspect→delete run** — deferred until the ESM+
  IP/environment is stable. Later command:
  `npm run capture-esm-review -- --i-understand-this-opens-live-esm --approved-index 0 --inspect-schema-shape`
  (still requires separate explicit approval).
- **Schema mapping verification** — confirm header→field bindings against a real
  workbook (`schemaMappingConfirmed` currently false).
- **Dedup key verification** — confirm the dedup-key candidate(s)
  (`dedupKeyConfirmed` currently false).
- **DB ingest** — actually ingesting a captured export (none performed).
- **Persistence of `ConnectorSyncState`** — the model is in-memory pure logic only.
- **Scheduling worker** — computing/firing syncs on the internal cadence.
- **Dashboard UI** — surfacing the derived fields.

---

## 6. Safety boundaries (in force)

- **No raw identifiers** — buyer/order/seller/Master/account/review ids never emitted.
- **No raw URLs / paths / filenames** — sanitized hashes + categories only.
- **No row/cell content** — Gate 4 reads workbook structure + the header row only;
  headers surface as hash + category, never raw text.
- **No upload / DB / status writes yet** — capture is observe-and-discard; the sync
  model is pure logic; existing status-write code is untouched.
- **No `CONFIRMED` capability yet** — REVIEW remains `NEEDS_DISCOVERY`;
  `schemaMappingConfirmed:false`, `dedupKeyConfirmed:false`.
- **No git operations until explicitly approved** — nothing staged/committed/pushed;
  all work is local and uncommitted by standing directive.
