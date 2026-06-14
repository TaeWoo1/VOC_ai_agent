# SellerOps Phase 3C — Naver ORDER_SUMMARY Live-Smoke Runbook

Originally written at HEAD `78098d8` (Slice 1b) as preparation. **The smoke has
since been executed successfully** (see §0). Re-running it still requires
separate explicit operator authorization. Target environment: a local/dev stack
(local Postgres, seeded demo org). Never a production or shared DB.

Sections §A–§J below remain the operator procedure for any future run; §0
records the first successful execution and the operational cautions learned from
it.

---

## 0. Executed result — first successful live smoke

**Run date:** 2026-06-14. **Backend HEAD:** `790b10f` (Slice-4 pacing/backoff,
connector flag on, scheduler off). **Seller account:** the seeded demo NAVER
account. Exactly one manual `ORDER_SUMMARY` sync was run; no automatic retry.

### Result

| field | value |
|---|---|
| `jobType` | `NAVER_API` |
| `status` | **SUCCESS** |
| `rateLimited` | `false` |
| `failedRows` | 0 |
| `errorMessage` | (none) |
| `totalRows` | 0 |

`totalRows=0` is **success, not failure**: no orders had changed since the
previous successful cursor position, so there was nothing new to upsert. The run
walked its window range under pacing and converged cleanly.

### Relevant commits

| commit | role |
|---|---|
| `b61e3b8` | surface sanitized Naver order API error details (readable `errorMessage`, no secret/PII leakage) |
| `4ae06c8` | vendor the Naver Commerce API LLM reference docs (`docs/vendor/naver-commerce-api/`) |
| `790b10f` | pace Naver API calls using rate-limit headers (per-process floor + header-aware backoff + 429 classification) — the fix that turned the earlier 429 PARTIAL into this clean SUCCESS |

### What was validated end-to-end

- **Credential vault decrypt** — `CredentialVault.open` produced usable
  `client_id`/`client_secret` (no `마스터 키`/`자격 증명` failure).
- **Token mint** — signed-timestamp token exchange succeeded (run proceeded
  past the always-first token call).
- **`last-changed-statuses`** — change-status query returned and parsed across
  the window (no `변경 주문 응답을 해석할 수 없습니다`).
- **Detail / amount lookup path** — `product-orders/query` detail/amount path
  executed without `결제 금액(initialPaymentAmount)이 없습니다` or missing-id
  errors. **Caveat:** because the delta was empty (`totalRows=0`), no order rows
  were parsed, so the §F amount-field *shape* (`initialPaymentAmount`,
  `data.more` pagination, batch limits) is **still unconfirmed against live
  data** — it remains open in `docs/sellerops_phase3c.md` §12 and needs a smoke
  against an account with a recent paid order.
- **Cursor preservation** — `sync_cursors` row is valid Naver JSON with the
  expected keys (`windowFrom`, `windowTo`, `moreFrom`, `moreSequence`,
  `dayTotals`, `dedupeIds`, `edgeIds`); cursor was not reset.
- **`order_daily_summaries` upsert / preservation** — table intact (43 rows,
  2026-05-03 → 2026-06-14); with `totalRows=0` nothing was upserted and prior
  totals were preserved (upsert-by-`(channel, date)` semantics confirmed
  non-destructive on an empty delta).
- **`connection-status` = CONNECTED** — `lastSuccessAt` advanced to the run's
  finish, `consecutiveFailures=0`, `lastError=null`.
- **`rateLimited=false` after pacing** — the pacer (thread dump confirmed the
  worker sleeping in `NaverRequestPacer.acquire` between calls) kept the run
  inside the per-second budget; no 429 occurred.

### Operational cautions (learned / reaffirmed)

- **Do not reset the cursor** unless a stale *mock* cursor is proven. The live
  cursor is valid Naver JSON; deleting it forces a fresh full backfill. Only the
  `커서를 해석할 수 없습니다` corruption case (§G) justifies deletion.
- **Scheduler must stay disabled** (`sellerops.collect.scheduler-enabled=false`)
  during any manual smoke — manual sync only, never background polling.
- **Do not repeatedly retry on 429.** A 429 ends the run with the cursor
  preserved; retry at most once after a wait (§G/§H). The pacer exists precisely
  so a healthy run never reaches that path.
- **Keep the backend process alive** across a sequence of test syncs so the
  in-memory access-token cache is reused — restarting re-mints a token and adds
  avoidable token-endpoint load.
- **Never expose secrets, tokens, or raw order payloads** — no credentials,
  bearer tokens, or full response bodies in logs, errors, docs, or chat. Verify
  via aggregate fields (`SyncRunView`, connection-status) and DB counts/keys
  only.
- **A caught-up sync is not instant.** This run took ~13.5 min wall-clock for
  `totalRows=0` because the pacer adds the floor interval (~1s) to every
  `last-changed-statuses` call across the window range. That is expected with
  the current 1s floor; if smoke turnaround matters, lower
  `sellerops.connector.naver.min-request-interval-millis` for the test (it never
  hit a 429 at 1s) rather than removing pacing.

### Next development options

- **UI/API status internalization** — surface connection-status / run history /
  `rateLimited` in the operator UI so smokes don't require raw API/DB probing.
- **Product / order detail expansion** — extend beyond ORDER_SUMMARY to
  PRODUCT (and the richer order-detail fields catalogued in §F).
- **Claim connector** — claim/cancellation (`remainPaymentAmount`-adjusted)
  data path.
- **Review connector** — currently UNSUPPORTED on Naver (no public review API);
  revisit only if Naver ships one.
- **Scheduler / pacing hardening** — promote live-confirmed limits into config,
  add executor-level 429 coverage against real behavior, and define
  scheduled-collection enablement criteria (Slice 1c).

---

## A. Purpose

- Verify the real Naver connector once, with **operator-supplied throwaway
  credentials**: token issuance (signature/timestamp), the
  `last-changed-statuses` response shape, `product-orders/query` amount fields,
  pagination (`data.more`), and cursor behavior.
- Close the open schema items recorded in `docs/sellerops_phase3c.md` §12
  (live-smoke checklist).
- **This is not a production rollout.** One account, one data type
  (ORDER_SUMMARY), manual sync only, then everything is turned back off.

## B. Preconditions

| # | Check |
|---|---|
| 1 | Naver Commerce API Center access with a real seller account |
| 2 | Application/client registration complete; `client_id` / `client_secret` issued (the secret is a bcrypt-salt-format string — that is expected) |
| 3 | The seller account has at least one paid order in the last 24h (the connector's initial backfill window) — otherwise expect a clean empty run |
| 4 | IP allowlist: confirm in API Center whether the dev machine's public IP must be (and is) registered |
| 5 | `SELLEROPS_VAULT_MASTER_KEY` set (base64, 32 bytes) in the backend's environment |
| 6 | `SELLEROPS_CONNECTOR_NAVER_ENABLED=true` for the smoke run only |
| 7 | `sellerops.collect.scheduler-enabled` stays **false** (default) — manual sync only, no polling |
| 8 | Backend runs against a disposable/dev DB; the seeded demo org has a NAVER seller account (`MockDataSeeder` seeds one) |

Note on demo data: the seeder also seeds ~14 days of `order_daily_summaries`.
A live sync **upserts by (channel, date)** and will overwrite the seeded demo
rows for the dates it touches — expected; the evidence check below looks at
exactly those dates.

## C. Secrets policy

- **Never commit credentials** — not in code, config, fixtures, this doc, or
  commit messages.
- **Never paste credentials into logs, issues, or chat.** The backend never
  logs them by design; keep it that way on the operator side too.
- Store secrets **only** through the credential intake API (below) — they land
  AES-256-GCM envelope-encrypted; the API answers with masked metadata only.
- Shell hygiene for any manual `curl`: export secrets from the git-ignored
  local env file `backend/.env.local`
  (`set -a; source backend/.env.local; set +a`), never type them inline.
  Setup walkthrough: `docs/sellerops_local_env_setup.md`. The Naver values are
  removed from the file after the smoke.
- Use **throwaway/revocable credentials**; rotate or revoke them in the API
  Center after the test regardless of outcome.

## D. Step 1 — token-only smoke

The connector is fail-fast: the **token mint is always the first outbound
call**, and any credential problem stops the run before any HTTP. So the first
manual sync doubles as the token smoke — its failure class is readable from
the run's `errorMessage`.

1. Log in and get a JWT (seeded demo login or your own signup):
   `POST /api/auth/login` → bearer token for all calls below.
2. Find the NAVER seller account id: `GET /api/seller-accounts` → the account
   whose channel is NAVER (`fileUpload=false`).
3. Store the credential (write-only; response is masked metadata):

   ```
   POST /api/seller-accounts/{accountId}/credentials
   {"connectorClass":"API","authType":"OAUTH2",
    "secrets":{"client_id":"<from env>","client_secret":"<from env>"}}
   ```

4. (Optional, outside the app) A pure token probe with `curl` against
   `POST https://api.commerce.naver.com/external/v1/oauth2/token`
   (`application/x-www-form-urlencoded`; signature = base64(bcrypt(client_id +
   "_" + timestamp_ms, salt=client_secret))). Only do this with the env-file
   hygiene above; do not save responses containing the access token.

**Failure signals** (as the sync run's `errorMessage`):

| Message contains | Meaning |
|---|---|
| `마스터 키가 설정되지 않았습니다` | Vault closed — `SELLEROPS_VAULT_MASTER_KEY` missing/invalid |
| `저장된 자격 증명이 없습니다` | No credential stored for this account (or wrong account id) |
| `전자서명 솔트 형식이 아닙니다` | `client_secret` is not the bcrypt-salt string Naver issued (copy/paste error) |
| `인증 토큰 발급에 실패했습니다 (HTTP 401/403)` | Signature/timestamp rejected, app not approved, or **IP allowlist** — check API Center error detail; verify machine clock (the signed timestamp must be current millis) |
| `인증 토큰 응답을 해석할 수 없습니다` | Token endpoint returned an unexpected body — capture HTTP status, stop |

Success signal: the run proceeds past the token call (any subsequent
order-query activity or a SUCCESS/empty run means the token path works).

## E. Step 2 — small ORDER_SUMMARY manual sync

1. Restart the backend with `SELLEROPS_CONNECTOR_NAVER_ENABLED=true`
   (scheduler stays off). Sanity check first: with the flag on, the registry
   routes NAVER to the real connector — **only this account/data type is
   affected**; all other channels keep the mock.
2. Run exactly one manual sync:

   ```
   POST /api/seller-accounts/{accountId}/sync
   {"dataType":"ORDER_SUMMARY"}
   ```

   This is synchronous and returns the run. The initial window is the last
   24h; one run is typically 1 `last-changed-statuses` call + ≤1 detail batch
   — well inside the 2 rps limit.
3. Evidence to record (no secrets, no full response bodies — they contain
   order PII):
   - `GET /api/sync-runs?sellerAccountId={accountId}` → the run is
     SUCCESS (rows or a clean empty run) / PARTIAL / FAILED with the messages
     from §D/§G; `jobType=NAVER_API`, `trigger=MANUAL`.
   - DB `sync_cursors` row for (account, `ORDER_SUMMARY`): `cursor_value` is
     JSON containing `windowFrom`/`windowTo`.
   - DB `order_daily_summaries`: rows for the last-24h KST date(s) now carry
     real `order_count`/`sales_amount` — cross-check the amounts against
     스마트스토어센터 for the same date before trusting them.
   - `GET /api/seller-accounts/{accountId}/connection-status` → CONNECTED,
     `lastSuccessAt` set, failures 0.
   - No frontend, Python tree, or migration involvement at any point.
4. Idempotency probe (optional): run the same manual sync again — the second
   run should be a clean empty/converged run (cursor caught up), and daily
   totals must not double.

## F. Fields to verify from the live response

Record these findings (they close `docs/sellerops_phase3c.md` §12); inspect
via the optional curl probe or DB evidence, never by pasting full bodies:

1. `data.lastChangeStatuses[]` item shape — confirm the six assumed fields
   (`productOrderId`, `orderId`, `productOrderStatus`, `lastChangedDate`,
   `lastChangedType`, `paymentDate`) and note any we should also use.
2. `data.more` behavior — does it appear only when a page is full; exact
   `moreFrom`/`moreSequence` semantics; observed per-page maximum (300?).
3. `productOrder.initialPaymentAmount` — present? (our salesAmount basis)
4. `productOrder.remainPaymentAmount` — present? (future claim-adjusted basis)
5. `totalPaymentAmount` — confirm absent/deprecated (we never read it).
6. `productOrderIds` batch limit — only if discoverable without hammering
   (e.g. documented error on an oversized batch); config default is 100.
7. orderCount semantics — compare a day's `order_count` (product-order rows)
   with 스마트스토어센터's 주문 수; note whether operators will expect
   distinct-order counting instead.

## G. Failure handling

| Failure | Reading | Action |
|---|---|---|
| 401/403 on token | Signature/timestamp/approval/IP — see §D table | Fix one variable at a time; re-run once per fix |
| 401/403 on order calls | Token fine but scope/permission missing | Check application permissions in API Center |
| 429 (`GW.RATE_LIMIT`) | Run ends `rateLimited=true`, FAILED/PARTIAL, message `속도 제한`; health failure counter untouched by design | Wait ≥1 minute; retry **once**; never loop |
| IP allowlist failure | Typically 403 at token issuance | Register the IP or run from an allowed host; record it as a deployment constraint |
| `결제 금액(initialPaymentAmount)이 없습니다` | Amount field missing from detail response | **Stop** — schema differs; record the actual field names |
| `주문 상세 응답에 누락된 상품주문이 있습니다` | Detail response didn't echo a requested id | Stop and record; possible claim-state filtering we don't know about |
| `변경 주문 응답을 해석할 수 없습니다` | Pagination/shape differs from fixtures | Stop and record the actual shape |
| Empty order window | SUCCESS with 0 rows — not a failure | Verify the seller account actually had paid orders in the window |
| Cursor corruption (`커서를 해석할 수 없습니다`) | `cursor_value` damaged | Delete the `sync_cursors` row for (account, ORDER_SUMMARY); next run starts a fresh 24h backfill; upsert-by-date keeps totals convergent |

## H. Stop conditions — abort the smoke immediately if

- A 429 appears more than once in a row (do not retry aggressively; the 2 rps
  budget is per application).
- Amount fields are missing or named differently than assumed.
- The response schema differs from the fixture assumptions in any way the §G
  table doesn't already classify.
- Any credential or token value appears in a log, error message, or terminal
  output (then rotate immediately).
- Persisted daily totals are obviously wrong vs 스마트스토어센터 (overwrite
  semantics mean wrong totals propagate — stop and diagnose offline).

## I. Rollback / cleanup (always, regardless of outcome)

1. Unset `SELLEROPS_CONNECTOR_NAVER_ENABLED` (back to default false) and
   restart — NAVER resolves to the mock again.
2. Confirm the scheduler was never enabled (`scheduler-enabled=false`).
3. Rotate or revoke the throwaway credentials in the API Center.
4. The encrypted `connector_credentials` row may stay (it is ciphertext under
   a local key) or be removed with a direct dev-DB delete; there is no delete
   API by design. If the dev DB is disposable, dropping it covers everything.
5. Delete the `NAVER_COMMERCE_*` values from `backend/.env.local` (or the
   whole file); clear shell history if secrets were ever typed inline (they
   should not have been).
6. Record the §F findings in `docs/sellerops_phase3c.md` §12 (schema items
   confirmed/refuted) — findings only, never response bodies.

## J. Post-smoke decision

- **Token + one small ORDER_SUMMARY sync succeed, schema matches fixtures** →
  approve **Slice 1c (operational hardening)**: live-confirmed limits into
  config, executor-level 429 coverage against real behavior, credential intake
  UX, and scheduled-collection enablement criteria.
- **Schema differs** → patch the parser/DTOs and fixtures first (a scoped
  follow-up slice), re-run the smoke, only then consider 1c.
- **Setup blocked** (registration/IP allowlist) → record "blocked: <reason>"
  in §12 — do not fake results — and consider the Coupang HMAC fallback path
  from the Phase 3C plan (offline-verifiable signer, no token round-trip).
