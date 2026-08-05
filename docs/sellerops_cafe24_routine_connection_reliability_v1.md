# Cafe24 Routine + Connection Reliability Hardening v1

> **What this is.** A code slice hardening the Cafe24 connection lifecycle and the reliability of
> repeated (routine) collection — built **offline, no marketplace write, no migration**. It does
> **not** promote any capability: capability truth stays `docs/multi-channel-connector-roadmap.md`
> §4.1, and the pilot-v1 baseline stays `docs/sellerops_cafe24_channel_v1_completion.md` (fixed at
> `97ad192`). This slice sits **on top of** that baseline.

Branch: `feat/cafe24-routine-connection-reliability-v1` (base `main` `f4eacee`).

## 1. Audit-premise correction (single-flight / orphan recovery / cursor durability)

The preceding audit (`docs/` memory `cafe24-first-connection-routine-ops-audit-v1`) flagged
"routine collection never single-flight" as a P1 gap. **Deeper reading corrected this at the code
level:** single-flight and orphaned-RUNNING recovery are **already channel-agnostic** and already
cover Cafe24. All collection — NAVER and Cafe24 — funnels through `SyncRunExecutor` →
`SyncRunGate.beginRunOrCoalesce(sellerAccountId, dataType, …)`, which takes a `PESSIMISTIC_WRITE`
row lock, lazily reclaims RUNNING jobs older than `sellerops.collect.sync-stale-after-minutes`
(default 60), and coalesces onto a fresh in-flight run. Cafe24's three streams
(`DataType.ORDER_SUMMARY` / `REVIEW` / `INQUIRY`) are ordinary data types, so each single-flights
independently and recovers orphans independently.

Cursor/window durability is likewise already robust: the article cursor lives in `sync_cursors`,
is advanced **only after** each page is persisted, and is left unchanged on a 429; orders re-fetch
a full idempotent 14-day window; upserts are natural-key / `source_hash` (V7) / external-id (V34)
guarded. So a restart mid-run is safe, and repeating the same window never duplicates.

**What was actually never done is a *live* scheduled proof** (every prior live run had the scheduler
off). That live proof remains deferred to a fresh approval and is out of scope here.

**Deliverable:** a regression test (`SyncRunGateTest.cafe24ThreeStreamsAreEachSingleFlightAndIndependentlyOrphanRecovered`)
pinning the guarantee for the three Cafe24 streams explicitly — not a re-implementation.

## 2. Connection-reliability hardening (the new code)

### 2.1 Token-error diagnosis split
`Cafe24TokenClient.refresh` and `Cafe24OAuthClient.exchangeAuthorizationCode` previously threw one
generic `IllegalStateException` on any non-2xx, so every failure collapsed to
`AuthProbe.AUTH_FAILED → RECONNECT_REQUIRED`. They now throw a classified `Cafe24OAuthException`:

- Classification is by the **RFC 6749 §5.2 / RFC 6750 §3.1 standard** `error` field **only** —
  `invalid_grant` → `INVALID_GRANT` (dead token → reconnect), `invalid_scope` /
  `insufficient_scope` → `INSUFFICIENT_SCOPE` (a missing read permission, **not** a dead
  credential). **Any other or unparseable value → `UNKNOWN`**, handled exactly like the old generic
  failure. No Cafe24-proprietary code is guessed or hardcoded (empty of provider-specific codes,
  mirroring the NAVER order-access diagnosis discipline).
- Sanitized: only the HTTP status and the recognized standard code appear in the message;
  `error_description` and any other body field are never read into it.
- `Cafe24ConnectionCapabilityService` maps `INSUFFICIENT_SCOPE` → new
  `AuthProbe.SCOPE_INSUFFICIENT` → new reason `SCOPE_INSUFFICIENT`; `INVALID_GRANT` / `UNKNOWN`
  stay `AUTH_FAILED` (reconnect). FE surfaces `SCOPE_INSUFFICIENT` as its own cause
  (`cafe24Tutorial` failure `scope_insufficient` + `CAPABILITY_REASON_COPY`), distinct from the
  re-consent guidance for a dead token.
- **Known limitation (conservative, by design):** `Cafe24OAuthException` is thrown only by the
  **token endpoints**, so `SCOPE_INSUFFICIENT` fires when a scope error surfaces there. A scope
  denial that appears only on a **resource** call (e.g. a 403 on board discovery) is **not**
  re-classified — without a live-verified scope-error body we do not guess, so it stays
  `RECONNECT_REQUIRED`. Classifying resource-level scope denials (only from a standard `error` body)
  is a documented follow-up.

### 2.2 Refresh-token concurrency guard
Cafe24 refresh tokens are single-use. Because the three streams are distinct data types, the gate
admits them concurrently, and the capability probe can run at the same time — so multiple callers
could refresh the same shared token, one winning the rotation and the others getting a spurious
`invalid_grant`. `Cafe24Authorizer.authorize` now:

1. Serializes the open→refresh→rotate section per seller account with an in-process lock
   (`Cafe24AccountRefreshLocks`; the pilot runs a single backend host). Different accounts still
   proceed concurrently.
2. On `invalid_grant`, re-reads the credential once: if the stored refresh token **changed**, the
   one we used was merely superseded by another process → retry with the current token (recovers a
   cross-process race). If **unchanged**, the token is genuinely revoked → propagate. This retries
   at most once and never double-rotates (rotation write-back happens only on a successful refresh,
   preserving the existing "persist replacement before use" invariant).

### 2.3 Callback mall-identity assertion (fail closed)
`Cafe24OnboardingService.complete` now accepts the `mall_id` Cafe24 **may** append to the callback
(`Cafe24ConnectController` passes the query param). Behaviour:

- **Present and mismatched** against the seller-intended `state.mallId` → fail closed as
  `CompletionStatus.INVALID`: no code exchange, no credential persisted, and a working connection is
  **never** downgraded. This is a different-shop consent — not a retryable reconnect with this mall.
- **Absent** → not a signal (Cafe24's callback commonly omits the mall host, per the
  `Cafe24OAuthState` invariant); behaviour is unchanged (identity remains host-bound to the intended
  mall, exactly as before).
- The intended `mall_id` shape is re-validated at callback time (start-time validation only ran on
  the original input).
- **Unverified echo format, handled tolerantly:** the exact value Cafe24 appends (bare label vs a
  qualified host, case) is **not live-verified**, so the callback value is normalized to a bare mall
  label (lower-cased, host suffix stripped) before comparison, and a value that cannot be resolved
  to a valid label is treated as **absent** (never a mismatch). The gate therefore fails closed
  **only** on a positive, unambiguous different-mall — it can never wrongly reject a legitimate
  connect on an unexpected format.

**Deferred:** an independent `shops/me`-style identity read (comparing an authoritative returned
shop id) is **not** built here — its wire format is unverified and it needs a live-read approval;
adding a guessed-format hard gate would risk the live-proven connect flow. Documented as future
strengthening.

### 2.4 Callback documentation reconciliation (D18)
The dev receiver `tools/cafe24-callback` uses `/cafe24/callback`; the product endpoint is
`/api/connect/cafe24/callback`. This is **different by design** (the dev tool never exchanges the
code). The README now states this explicitly and no longer cites a non-existent in-repo protocol
doc (`§P5`/`§P7`); the connectivity-decision doc's "미추적" (untracked) claim was corrected (the tool
is git-tracked); and canonical-reference row **D18** was marked reconciled.

## 3. Scope fences (what this slice does NOT do)

- **No live Cafe24 write, no reply adapter** — Cafe24 stays read-only; reply-WRITE is the separate
  deferred v1.1 capability, needing its own live-write approval.
- **No migration** — all changes are in-process (top migration stays `V36`; `V35` remains a reserved
  gap for draft PR #371, which must renumber to `V37+`).
- **No production provisioning, no real IP/secret/credential** committed.
- **Scheduled/routine LIVE proof deferred** to a fresh approval.

## 4. Verification

- backend `./gradlew test` — full suite green (includes the new
  `Cafe24AuthorizerTest`, token-diagnosis, capability-mapping, onboarding mall-mismatch, and
  `SyncRunGate` Cafe24 three-stream tests).
- frontend `tsc --noEmit` + `vitest run` + `vite build` — green (incl. the `pages-copy` seller-copy
  guard and the new `interpretCapability` scope test).

## 5. Pointers

Baseline `docs/sellerops_cafe24_channel_v1_completion.md` · capability truth
`docs/multi-channel-connector-roadmap.md` §4.1 · callback-path divergence
`docs/sellerops_canonical_reference.md` D18 · connectivity
`docs/sellerops_local_to_pilot_connectivity_decision.md` · single-flight lineage
`docs/` NAVER `sync-single-flight-recovery-v1`.
