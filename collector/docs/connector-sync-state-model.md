# Connector Sync State Model (multi-channel) — design note

> **Status: design-only.** No code, no live browser, no marketplace access, no
> API call, no DB migration, no scheduler/`manualSync` implementation. This note
> defines a **channel-agnostic** sync state model spanning NAVER, ESM+, Cafe24,
> and future commerce channels. It sits **above** the run-level `CollectorState`
> (`src/status.ts`) and **alongside** the per-store `ConnectionStatus`
> (`docs/connection-onboarding.md`), unifying both into one durable
> per-(channel × account) sync record.

---

## 1. Why this exists

Today there are two separate, channel-specific state layers:

- the **run-level** `CollectorState` (one export attempt's outcome), and
- the **connection-level** `ConnectionStatus` (NAVER store binding).

Neither answers the product question a multi-channel dashboard must answer:
*"For this seller's ESM+ (and NAVER, and Cafe24) connection — is the data fresh,
when did it last sync, when will it sync next, and do they need to reconnect?"*
The connectors differ wildly in mechanism — ESM+/Cafe24 may expose an **official
API**, NAVER REVIEW is a **browser export**, and any channel can fall back to
**manual upload** — but the seller-facing sync state should look the **same**
across all of them. This model is that common layer.

### Anchor findings that shaped it (ESM+ REVIEW)

- Gate 2 located the actionable export control inside an **allowlisted frame** →
  a real `BROWSER_EXPORT` connector exists for this channel.
- The keep-open TTL probe stayed `LOGGED_IN` through **T+4h**, supporting an
  **internal ~2h sync cadence** for browser-export channels.
- Gate 3 proved **one supervised click → one structurally valid xlsx**, deleted
  after validation (observe-and-discard).
- Gate 4 schema-shape inspector + capture→inspect→delete wiring are implemented
  locally; the **live** schema-shape run is **deferred** (IP/environment
  instability).
- **REVIEW remains `NEEDS_DISCOVERY`; nothing CONFIRMED** — so the model must
  represent a channel that is *wired but not yet proven*, not just a binary
  on/off. That is exactly what `capabilityStatus` does below.

---

## 2. Core design principle — sync cadence ≠ report schedule

This is the load-bearing separation, and the rest of the model exists to keep it
honest.

| | Internal sync cadence | User report schedule |
|---|---|---|
| **Who controls it** | The **system** (per-channel policy) | The **user** |
| **What it drives** | When the worker *attempts* to refresh stored data | When the user is *shown/sent* a report |
| **Reads from** | The live channel (API / export / upload) | The **latest successful stored snapshot** |
| **Example** | ~2h for browser-export channels | "every Monday 09:00", "daily", on-demand |
| **Field** | `internalSyncCadenceMin`, `nextSyncAt` | `userReportSchedule` |

**Hard rule:** **report time is never equal to export/download time.** A report
renders from `lastSuccessfulSyncAt`'s snapshot; if a sync is mid-flight or failed,
the report still renders from the **last good** snapshot (and flags staleness).
The worker computes `nextSyncAt` from the **internal cadence**, *never* from the
user's report schedule. This decoupling is what lets a failed 03:00 sync not
break a 09:00 report, and what lets the system sync more often than the user ever
looks.

---

## 3. Connector types

A channel is reached through exactly one **active** connector type at a time,
with a defined fallback order. The state model is identical regardless of which
one is active — only `connectorType` and the cadence policy differ.

| `connectorType` | Mechanism | Cadence posture | Examples |
|---|---|---|---|
| `API` | Official authenticated API | System cadence, frequent; rate-limit aware | ESM+/Gmarket INQUIRY API, Cafe24 API |
| `BROWSER_EXPORT` | Human-attended export inside the user's own session | System cadence, **~2h** (TTL-bounded); one supervised capture | NAVER REVIEW export, ESM+ REVIEW export |
| `MANUAL_UPLOAD` | User uploads an export file | No system cadence; sync = the upload event | Any channel, interim bridge |
| `EMAIL_REPORT` *(future)* | Scheduled report email ingested by the system | System cadence tied to the email schedule | future channels |
| `NONE` | No connector available / disabled | No sync | unavailable channel |

**Fallback order** (most automatic → least): `API` → `BROWSER_EXPORT` →
`MANUAL_UPLOAD` → (`EMAIL_REPORT` future) → `NONE`. `connectorType` records the
**currently active** one; downgrading (e.g. `API` → `MANUAL_UPLOAD` after repeated
auth failure) is a product decision, not an automatic silent switch.

---

## 4. State fields

One record per **(channel × account/store)**. All identity is privacy-preserving
(hashes/categories only, consistent with the connection layer's
`boundStoreFingerprintHash` / `fingerprintSourceCategory`).

| Field | Type | Meaning |
|---|---|---|
| `channel` | enum | `NAVER` / `ESM` / `CAFE24` / … (the commerce channel) |
| `connectorType` | enum (§3) | Currently active connector mechanism |
| `accountRef` | hash + category | `boundStoreFingerprintHash` + `fingerprintSourceCategory`; **never** raw store/account identity |
| `capabilityStatus` | enum (§5) | Is this channel's data path discovered / verified / confirmed / degraded / disabled |
| `authStatus` | enum (§5) | Session/credential health |
| `syncStatus` | enum (§5) | The current/last sync lifecycle state |
| `lastSyncAttemptAt` | timestamp | When the worker last *attempted* a sync (success or not) |
| `lastSuccessfulSyncAt` | timestamp | When data was last *successfully* refreshed — the report snapshot anchor |
| `nextSyncAt` | timestamp | Next scheduled attempt, computed from **internal cadence** |
| `internalSyncCadenceMin` | int (minutes) | System cadence for this channel/connector (e.g. ~120 for browser-export) |
| `userReportSchedule` | schedule spec | User-controlled report cadence (cron-like / preset); **independent** of sync |
| `reconnectRequired` | boolean | Human must re-authenticate before sync can resume |
| `lastErrorCategory` | enum (§5) \| null | Coarse class of the most recent failure |
| `lastErrorAt` | timestamp \| null | When that failure occurred |
| `staleDataWarning` | boolean | Derived: latest snapshot is older than this channel's freshness threshold |
| `dataFreshnessLevel` | enum | `FRESH` / `RECENT` / `STALE` / `UNKNOWN` — coarse bucket derived from `lastSuccessfulSyncAt` vs. cadence |

**Snapshot vs. attempt:** `lastSuccessfulSyncAt` and `lastSyncAttemptAt` are kept
**separate on purpose** — a string of failed attempts must update
`lastSyncAttemptAt` / `lastErrorAt` **without** touching `lastSuccessfulSyncAt`,
so the report's snapshot anchor stays pinned to the last *good* data.

**Freshness derivation (no raw durations exposed):** `staleDataWarning` and
`dataFreshnessLevel` are **derived** from `lastSuccessfulSyncAt` against a
channel freshness threshold (typically a small multiple of
`internalSyncCadenceMin`). Consistent with the sanitization contract, the
dashboard surfaces the **coarse level**, not an exact elapsed duration.

---

## 5. Enums

```
capabilityStatus : NEEDS_DISCOVERY | NEEDS_VERIFICATION | CONFIRMED | DEGRADED | DISABLED
authStatus       : CONNECTED | RECONNECT_REQUIRED | AUTH_CHALLENGE | EXPIRED | UNKNOWN
syncStatus       : IDLE | SCHEDULED | RUNNING | SUCCEEDED | FAILED | PARTIAL | PAUSED
connectorType    : API | BROWSER_EXPORT | MANUAL_UPLOAD | EMAIL_REPORT | NONE
errorCategory    : AUTH | NETWORK | EXPORT_LAYOUT_CHANGED | DOWNLOAD_FAILED |
                   SCHEMA_CHANGED | PARSE_FAILED | RATE_LIMITED | PERMISSION | UNKNOWN
```

**Notes on meaning / mapping:**

- **`capabilityStatus`** carries the discovery posture honestly. ESM+ REVIEW is
  `NEEDS_DISCOVERY` right now; a channel whose wire shape is wired-but-unproven
  (e.g. ESM+ INQUIRY before the live probe) is `NEEDS_VERIFICATION`;
  `CONFIRMED` requires a proven end-to-end path; `DEGRADED` = works but reduced
  (e.g. API down → on browser-export fallback); `DISABLED` = intentionally off.
- **`authStatus`** is the channel-agnostic generalization of the NAVER
  5-state session verdict (`LOGGED_IN`→`CONNECTED`, `RECONNECT_REQUIRED`,
  `AUTH_CHALLENGE_REQUIRED`→`AUTH_CHALLENGE`, etc.) plus `EXPIRED` for a timed-out
  session and `UNKNOWN` before first contact.
- **`syncStatus`** is the lifecycle of one sync cycle. `PARTIAL` = some data
  refreshed but not all (e.g. one page/window failed); `PAUSED` = the worker is
  intentionally not scheduling (usually because `authStatus` is unusable or the
  connector is `NONE`/`DISABLED`).
- **`errorCategory`** unifies existing run/export error vocabularies:
  `EXPORT_LAYOUT_CHANGED` / `DOWNLOAD_FAILED` come from the browser-export world;
  `SCHEMA_CHANGED` / `PARSE_FAILED` from ingest; `RATE_LIMITED` from the ESM+
  429/`Retry-After` handling; `AUTH` / `NETWORK` / `PERMISSION` / `UNKNOWN`
  are cross-cutting.

### Status interplay (which combinations are legal)

- `authStatus ∈ {RECONNECT_REQUIRED, AUTH_CHALLENGE, EXPIRED}` ⇒
  `reconnectRequired = true` and the worker moves `syncStatus → PAUSED` (does not
  schedule a doomed attempt).
- `capabilityStatus ∈ {DISABLED}` or `connectorType = NONE` ⇒ `syncStatus = IDLE`,
  no `nextSyncAt`.
- `syncStatus = SUCCEEDED` ⇒ `lastSuccessfulSyncAt` advances; `FAILED`/`PARTIAL`
  ⇒ it does **not** (only `lastSyncAttemptAt` / `lastErrorCategory` / `lastErrorAt`).

---

## 6. Dashboard surface

The dashboard renders the **same** card for every channel, populated from the
fields above — never from a live call.

| Surface element | Source field(s) | Notes |
|---|---|---|
| Last successful sync | `lastSuccessfulSyncAt` | The report snapshot anchor |
| Next sync | `nextSyncAt` | From internal cadence, **not** report schedule |
| Current sync status | `syncStatus` | IDLE/SCHEDULED/RUNNING/… |
| Reconnect-required banner | `reconnectRequired` | Shown when auth is unusable |
| Stale-data warning | `staleDataWarning` + `dataFreshnessLevel` | Coarse level, not raw elapsed time |
| Channel capability badge | `capabilityStatus` | e.g. "Confirmed" / "In discovery" / "Disabled" |
| User report schedule | `userReportSchedule` | User-editable; independent of sync |
| Latest snapshot timestamp | `lastSuccessfulSyncAt` | "Report reflects data as of …" |

**Honesty rules (carry the existing product-copy memory):** no
roadmap/coming-soon language; the capability badge states the **real** posture
(`NEEDS_DISCOVERY` is shown as "in discovery", not as a finished feature). The
dashboard reads stored state only — opening it triggers **no** sync, click,
download, or API call.

---

## 7. Worker behavior

The sync worker is the only actor that mutates sync state. Its contract:

1. **`nextSyncAt` is computed from `internalSyncCadenceMin`**, per channel policy
   — **never** from `userReportSchedule`. Browser-export channels use the
   TTL-bounded ~2h cadence; API channels may go more frequent within rate limits.
2. **Skip / pause when auth is unusable.** If `authStatus ∉ {CONNECTED}` (or
   `reconnectRequired`), the worker does **not** launch a sync; it sets
   `syncStatus = PAUSED` and leaves the snapshot intact.
3. **Set `reconnectRequired` on auth/session failure.** An auth challenge,
   expiry, or reconnect verdict flips `reconnectRequired = true`,
   `authStatus` accordingly, and records `lastErrorCategory = AUTH`.
4. **Keep the last successful snapshot available even when a new sync fails.** A
   failed attempt updates only `lastSyncAttemptAt` / `lastErrorCategory` /
   `lastErrorAt` / `syncStatus`. The report keeps rendering from the last good
   snapshot.
5. **Never overwrite good data with a failed attempt.** Snapshot replacement is
   atomic and gated on `syncStatus = SUCCEEDED` (a `PARTIAL` result is a product
   decision — default: keep prior snapshot, surface `PARTIAL`).
6. **Channel-specific cadence policy.** Cadence, freshness threshold, and
   fallback order are per-channel/per-connector policy inputs, not hardcoded
   globally — `internalSyncCadenceMin` is set from that policy.
7. **One supervised capture for browser-export.** For `BROWSER_EXPORT`, a "sync"
   is the existing gated observe-and-discard-then-ingest path (one click, one
   download) under its own approval discipline — the worker schedules *when* it
   may run, never bypasses the live-approval gate.

---

## 8. Product copy (seller-facing intent)

Plain-language framing the UI should convey (final wording TBD with the
product-voice pass; honest-capability + no-roadmap rules apply):

- **Automatic freshness:** "SellerOps keeps your channel data updated
  automatically in the background — you don't run anything."
- **Report from latest good sync:** "Your reports are generated from the most
  recent successful sync, shown as the snapshot time on each report."
- **Reconnect honesty:** "If a channel needs you to reconnect, we'll show a
  reconnect banner — until then, your data may be stale, and reports will keep
  using the last successful sync."

Copy must **not** imply real-time/at-open syncing, must **not** promise a channel
is "Confirmed" while `capabilityStatus` says otherwise, and must explain
staleness without exposing exact elapsed durations.

---

## 9. Relationship to existing layers (no rework implied)

- **Below:** run-level `CollectorState` (`src/status.ts`) stays as-is — it
  describes **one** export attempt. A finished run *feeds* this model
  (`LAST_SUCCESS` → `syncStatus=SUCCEEDED` + advance `lastSuccessfulSyncAt`;
  `EXPORT_FAILED`/auth-stop → `FAILED`/`PAUSED` + error category).
- **Beside:** the connection layer's `ConnectionStatus` + drift guard
  (`docs/connection-onboarding.md`) own **binding/auth identity**; this model
  *reads* their outcome into `authStatus` / `accountRef` / `reconnectRequired`
  rather than re-implementing fingerprinting.
- **Channel-agnostic by construction:** the same record shape holds for an API
  channel and a browser-export channel; only `connectorType` + cadence policy
  differ. This is what lets Cafe24/future channels drop in without a new model.

---

## 10. Out of scope for this pass

No worker implementation, no scheduler, no DB schema/migration, no backend
endpoints, no dashboard UI, no `manualSync` trigger. Cadence *values*, freshness
*thresholds*, and the exact `userReportSchedule` grammar are named here as policy
inputs but **not finalized**.

> Update: the **offline core** below has since been built (the §10 "type-only
> sketch" note is superseded by §11). Worker/scheduler/DB/endpoint/UI remain out
> of scope.

---

## 11. Implementation status — offline core built (pure, no I/O)

> The model is now implemented **offline and end-to-end as pure logic** — types →
> derivations → reducer → read-only bridge. There is still **no** worker,
> scheduler, DB entity, migration, API endpoint, dashboard UI, `manualSync`, or
> any I/O. Nothing here syncs, persists, or touches a marketplace; it is the
> data/decision layer only. All four modules are pure leaves with zero runtime
> dependencies and full unit tests.

| Layer | Module | What it is |
|---|---|---|
| **Types** | `src/connection/sync-state.ts` | The §4 field set + §5 enums as string-literal unions: `CommerceChannel`, `ConnectorType`, `CapabilityStatus`, `AuthStatus`, `SyncStatus`, `SyncErrorCategory`, `DataFreshnessLevel`, `SanitizedAccountRef` (hash + category only), `UserReportSchedule`, and the assembling `ConnectorSyncState`. No runtime. |
| **Derivations** | `src/connection/sync-state-derive.ts` | Pure dashboard/scheduling derivations: `deriveNextSyncAt` (internal cadence only — `userReportSchedule` is not a parameter), `deriveDataFreshnessLevel`, `deriveStaleDataWarning`, `deriveReconnectRequired`, and the display combiner `deriveConnectorDashboardState`. `now` is always an explicit arg; timestamps use the sanctioned offset parser + a manual ISO formatter — **no `Date.now`/`Date.parse`/`new Date`/`Date.UTC`**. |
| **Reducer** | `src/connection/sync-state-reduce.ts` | `applySyncOutcome(state, outcome, now, policy?)` → a **new** `ConnectorSyncState` (never mutates input). `SyncOutcome` = `SUCCEEDED \| FAILED \| PARTIAL \| AUTH_RECONNECT_REQUIRED \| PAUSED` + optional sanitized `errorCategory`/`authStatus`/`meta`. Only `SUCCEEDED` advances `lastSuccessfulSyncAt`; failures/partials/pauses preserve the last good snapshot; derived fields are recomputed so the result is idempotent under the derivations. |
| **Bridge** | `src/connection/sync-outcome-bridge.ts` | Read-only `mapCollectorStateToSyncOutcome` / `mapConnectionStatusToSyncOutcome` — translate the existing run-level `CollectorState` and connection-level `ConnectionStatus` enums into a sanitized `SyncOutcome`. Type-only imports of the status enums (no status-writing code pulled in); does **not** call `applySyncOutcome` or write anything. |

**Flow (all offline, all read-only w.r.t. the existing collector):**

```
existing run/connection status  →  SyncOutcome        (sync-outcome-bridge.ts, pure map)
SyncOutcome + prior state + now →  ConnectorSyncState  (sync-state-reduce.ts, pure reducer)
ConnectorSyncState + now        →  dashboard fields    (sync-state-derive.ts, pure derive)
```

**Invariants enforced by tests across all four modules:**

- **Cadence ≠ report schedule** — `nextSyncAt` derives from `internalSyncCadenceMin`
  only; changing `userReportSchedule` never changes it (structural: it is not a
  parameter of `deriveNextSyncAt`). Report time ≠ export/download time.
- **No fake success / no good-data overwrite** — only `SUCCEEDED` advances the
  snapshot anchor; failed/partial/paused outcomes leave `lastSuccessfulSyncAt`
  pinned to the last good value.
- **Determinism / no wall clock** — every function takes `now` explicitly; no
  `Date.now`/`Date.parse`/`new Date`/`Date.UTC`, no timers, no scheduler.
- **Sanitized throughout** — identity is hash + category only; outcomes are
  enums + coarse categories/buckets; no raw id, filename, path, URL, selector,
  DOM, marketplace identifier, or row/cell content can flow through.
- **No I/O / no coupling** — no DB, API, browser, upload, status write, or
  `manualSync`; existing `src/status.ts` runtime behavior is untouched.

**Still deferred (unchanged from §10):** the worker that *schedules and runs*
syncs on the internal cadence, persistence of `ConnectorSyncState`, the dashboard
UI, and finalized cadence/freshness/report-schedule policy values. Each is its own
separately-approved slice.
