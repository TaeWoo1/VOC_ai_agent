# Cafe24 INQUIRY_READ Live Proof v1 — SUCCESS (exact-window contract)

**Status: LIVE-PROVEN.** Board-6 (문의사항) INQUIRY read, including the exact-window
backfill contract, is proven on real Cafe24 (전선몰딩, disposable env). This supersedes the
earlier HALT records (see "Prior HALT records → historical" below). Sanitized throughout:
counts / booleans / dates / schema facts only — no inquiry title/body, writer,
member/email/IP/order identifiers, mall/account/org IDs, tokens, or credential material.

## Scope proven (single-use approval, consumed)

- channel **Cafe24**, seller **전선몰딩** existing bound credential only, **board 6 only**.
- requested window **`2025-03-24 … 2025-03-24` KST** (created_date basis, single day).
- disposable DB `cafe24_phaseb` on `127.0.0.1:55432`; real sellerops untouched.
- Backend booted by `tools/cafe24-local/run-backend-local.sh` in **NORMAL mode**
  (`SELLEROPS_BOOTSTRAP_ALLOW_REKEY` unset) — the pre-boot credential gate returned
  **`decryptable=true`** (key-id `local-dev-1`), so the boot was not bypassed.

## Preparation gate (all passed before any live call)

| check | observed |
|---|---|
| pre-boot credential gate | `decryptable=true` (key-id local-dev-1) |
| `GET /health` | 200 `{"status":"UP"}` |
| JDBC target | `cafe24_phaseb` on `127.0.0.1:55432` |
| Flyway max version | 34 |
| `inquiries.is_secret` column | present |
| connector credential rows | 1 |
| board-6 inquiry baseline / total inquiries | 0 / 0 |
| OPEN inquiry work items | 0 |
| scheduler | off |
| Cafe24 API version | 2025-12-01 |
| account connection state | CONNECTED, 0 consecutive failures |

## First run — `POST /backfill {INQUIRY, 2025-03-24 … 2025-03-24}`

**SyncRun SUCCESS** — `totalRows=1, successRows=1, skippedRows=0, failedRows=0`.

| expectation | observed |
|---|---|
| in-window rows emitted / ingested | **1** |
| matching board-6 inquiry rows | **1** |
| out-of-window row (created 2025-03-27) | **excluded before mapper/ingestion/work-item** |
| sanitized out-of-window excluded count (log) | **1** (`카페24 창 밖 게시글 제외: board=6 제외건수=1`) |
| source created date (KST) | **2025-03-24** |
| raw reply token `informStatus` | **C** (adopted as-is, not inferred) |
| canonical status | **ANSWERED** |
| `is_secret` | **true** |
| OPEN work item | **0** (ANSWERED → no open item) |
| buyer PII stored (author/email/member/ip/order) | **none** (`author` empty; no structured PII columns projected) |
| board access | **board 6 only** (no board 4/9) |
| REVIEW / ORDER_SUMMARY / product API | **none** |
| reply write / external send | **none** |
| credential rotation | **succeeded** (refresh rotated; row remains 1, payload valid) |

**This is the live proof of the exact-window contract:** the connector fetched the platform
window but the local KST `created_date` guard dropped the distinct 2025-03-27 article
*before* the mapper, ingestion, and any work-item creation — its fields never reached storage
or a log. Only the in-window 2025-03-24 article was ingested.

### Inbox vs Dashboard/analysis exposure (secret 비밀글 boundary), live-observed

- **Inbox / work feed** (`GET /api/inbox`): the secret inquiry **is present** (1 item, type
  `INQUIRY`, status `ANSWERED`) — it stays workable in the operator queue.
- **Dashboard** (`GET /api/dashboard/summary`): `newInquiries=0`, `unansweredInquiries=0`,
  `recentFeed=[]` — the secret inquiry is **excluded** from dashboard counts and feed.
- **Item analysis**: the analysis-eligible selection (the exact `findUnanalyzedByOrgId`
  secret-exclusion query, replicated read-only) returns **0** — a secret inquiry is never
  selected for analysis.

## Replay — one idempotent re-run of the same backfill

**SyncRun SUCCESS** — `totalRows=1, successRows=0, skippedRows=1, failedRows=0` (dedup no-op).

- inquiry row remains **exactly 1**; no second row, no second work item, no new audit chain.
- row fingerprint (external id / status / informStatus / is_secret / content hash /
  received_at) **byte-identical** across first-run and replay.
- OPEN work item remains **0**; the 2025-03-27 row remains **absent**.
- the exact-window exclusion (`제외건수=1`) fired again on the replay — the guard is
  deterministic across runs.
- credential rotation **succeeded again**; credential row remains 1.

## Observability

Out-of-window drops surface only as a **sanitized count** in the log
(`카페24 창 밖 게시글 제외: board=.. 제외건수=..`), mirroring the existing 비밀글 exclusion
count — never an article id, date, title, content, or writer. No new success enum and no new
telemetry system were added; this stays inside the existing SyncRun contract.
`sync totalRows` = rows **fetched in the platform window** (1 here); the out-of-window drop is
the separate sanitized count, not folded into totalRows.

## What this run contains that is proven vs. carried

- **Live-proven this run:** the exact-window guard (in-window kept, out-of-window dropped
  pre-mapper), `informStatus=C → ANSWERED`, `is_secret=true`, no OPEN item for an answered
  inquiry, buyer-PII non-storage, board isolation, Inbox-include / Dashboard+analysis-exclude,
  replay idempotency, and credential refresh rotation.
- **Not exercised by this single-day window (unchanged since prior stages):** public (`F`)
  inquiries, `N`/`P`/`UNKNOWN` reply tokens, and an N→C reply-state transition on re-collect.
  These remain **tests-proven only** (see `Cafe24InquiryIngestionFlowTest`,
  `IngestionServiceTest`). We do **not** infer any behavior for tokens this window did not
  carry.

## Prior HALT records → historical, not final

- `docs/sellerops_cafe24_inquiry_read_live_proof.md` — recorded the live run that
  **disproved** the exact-window contract (a single-day window ingesting a 2025-03-27 row) and
  the fix. That HALT is now **historical**: the fix it describes is the code proven here.
- `docs/sellerops_cafe24_inquiry_read_live_proof.md` (scratch, untracked) — an earlier
  paused attempt. **Historical**; superseded by this success.

Neither HALT is a statement of current capability; both are retained only as the audit trail
that led here.

## Change set carried by this proof (branch `feat/cafe24-inquiry-read-privacy-audit-v1`)

- **V34 migration** `V34__inquiry_secret_and_source_update.sql` (`inquiries.is_secret`,
  renumbered from V33 because main already holds V33 `agent_run_store`).
- **INQUIRY_READ production impl** (`6f69d32`): `is_secret` fail-closed derivation +
  source-aware upsert (no-op/update/insert) + N→C work-item reconcile + secret read-side
  exclusion.
- **Exact-window fix** (`1bd1893`): KST `created_date` clamp at the shared REVIEW+INQUIRY
  `fetchArticlePage` boundary, fail-closed, windowed-cursor-only, ORDER_SUMMARY untouched.
- **Local bootstrap** `tools/cafe24-local/` — Keychain-loaded fail-closed boot + boolean
  credential-decryptability gate + redirect-uri injection. **No secret is stored in the repo.**

### OAuth rekey recovery history (sanitized)

The first live attempt failed on **credential decryption** — the backend master key no longer
matched the key that had sealed `connector_credentials.encrypted_payload`. Recovery, all
operator-approved and scoped to reconnect + re-encryption only (no `/backfill`, no collection):

1. Diagnosed read-only that neither the file key nor the untested Keychain key could decrypt
   the stored payload (boolean-only `check_credential_decryptable.py`; no secret printed).
2. Booted once with `SELLEROPS_BOOTSTRAP_ALLOW_REKEY=true` and ran a **Cafe24 OAuth
   reconnect** for the existing 전선몰딩 binding, re-storing the credential under the new
   managed key (Keychain `sellerops-vault-master-key` / `local-dev-1`). Early attempts failed
   on a redirect-URI mismatch and an expired OAuth state (600s TTL); the in-TTL retry
   succeeded.
3. Restarted in **NORMAL mode**; the pre-boot gate then returned `decryptable=true`, which is
   the precondition satisfied for this proof.

No `encrypted_payload` was ever hand-edited; recovery was always via a real OAuth exchange.

## Disposable DB state after proof

`cafe24_phaseb` holds the proof result: board-6 inquiries = 1 (the in-window 2025-03-24
article), OPEN work items = 0, connector credential row = 1, 4 pre-existing daily order
summaries and 3 seller accounts unchanged. The disposable-DB **app-login** password for the
OWNER user was reset to an ephemeral value to mint a session JWT for the approved `/backfill`
call — this is the local dev app password only; the Cafe24 marketplace credential and the
vault master key were not touched.

## Next Cafe24 stage

Any further live INQUIRY/REVIEW read requires a **fresh single-use approval**
(channel / account / date / operator). For a given window the expected inquiry count is
whatever board-6 articles were genuinely **created** inside it (0, 1, or more) — not a fixed
number. The public/`N`/`P`/`UNKNOWN` and N→C transition behaviors above are still awaiting a
window that carries them.
