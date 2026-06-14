# SellerOps AI — Product Implementation Roadmap

**Mode:** Planning / sequencing document. No code is written from this file.
It defines the *order* in which existing scaffolds are turned into a usable
product, the BE/FE responsibility split per feature, the MVP cut line, and the
guardrails that keep us from vibe-coding past what the data actually supports.

Written at HEAD `e837f01` (Naver ORDER_SUMMARY live smoke recorded). Detailed
per-area facts live in:

- Connector reality + channel matrix → `docs/sellerops_phase3d_completion_summary.md`
- Naver connector slice plan → `docs/sellerops_phase3c.md`
- Naver live-smoke runbook (executed) → `docs/sellerops_phase3c_live_smoke.md`
- Screen-by-screen UI direction → `docs/sellerops_ui_reference.md`
- Operator-facing connector status → `docs/sellerops_ceo_connector_status_onepager.md`

This roadmap **does not restate** those; it sequences the work across them.

---

## 0. Where we actually are (ground truth, not aspiration)

Read this before believing any feature is "done." The skeletons are
extensive; the *proven-against-real-data* surface is small.

| Layer | State |
|---|---|
| Backend controllers | Exist for auth, channels, channel-capabilities, dashboard, orders, inbox, seller-accounts, sync-runs, sync-jobs, uploads, users, health. |
| Real collection path | **Naver ORDER_SUMMARY only**, now live-verified once (totalRows=0, caught-up). Every other channel is an auth skeleton with an empty capability set. |
| Connector skeletons | Coupang, Cafe24, ESM, 11st, SSG — auth chain proven offline, no fetch path, off by default (Phase 3D). |
| Frontend pages | All exist: Home, Channels, ChannelDetail, Orders, Inbox, Upload, ProductIssues, AiSearch, Reports, AlertSettings. |
| Frontend data source | Routes through `apiClient` with **mock-fallback** (`useApiData` + `mocks.ts`): a failed/absent backend call silently resolves to seeded data. **Screens are therefore not proven against the live backend.** |
| AI insight | Not wired in this tree; `ProductIssues`/`AiSearch` are mock-backed. |

**Implication for sequencing:** the dominant near-term risk is not "missing
features" — it is **mock-fallback masking the gap between what the UI shows and
what the backend actually returns.** Phase 2 (internalization) exists to remove
that mask channel-by-channel, starting with the one path we have live-verified.

---

## 1. Product goal

SellerOps AI gives **industrial / manufacturing e-commerce sellers** (often
40–50+ operators running multiple seller-center accounts) a single calm
operations surface that answers *"what needs my attention across my channels
today?"* — orders, sales, inquiries, reviews, and product issues — without
logging into each channel separately.

The unit of value is **one seller account → connected channel → collected
operational data → a dashboard + a sendable/operator-readable summary.** It is
an operations dashboard, not a chatbot and not a generic analytics playground.

**Current validated capability:** Naver ORDER_SUMMARY collection — credential
vault decrypt → token mint → orders query → cursor-preserving sync →
`order_daily_summaries` upsert → connection status CONNECTED, with rate-limit
pacing proven (no 429 after the Slice-4 pacing/backoff patch). This is the one
end-to-end-real path the rest of the product is built outward from.

---

## 2. Feature lineup

The product surface, grouped by what each feature answers for the operator.
Status reflects §0 ground truth.

| # | Feature | What it answers | Status |
|---|---|---|---|
| F1 | Channel / account connection | "Which channels am I connected to?" | BE+FE scaffold; Naver real |
| F2 | Credential registration / update | "How do I plug in my keys safely?" | BE intake real (vault); FE form scaffold |
| F3 | Connection status | "Is each channel actually reachable right now?" | BE `connection-status` real; FE scaffold |
| F4 | Manual sync | "Pull my latest data now." | BE `POST /sync` real for Naver; FE button scaffold |
| F5 | Sync run history | "Did my syncs work? what failed / was rate-limited?" | BE `sync-runs` real; FE not surfaced |
| F6 | Order / sales dashboard | "How are orders & sales trending?" | BE `dashboard`/`orders` exist; FE mock-fallback |
| F7 | Operational insights | "What needs action today?" | rule-based: not built |
| F8 | AI summary / report | "Give me the readable summary I can send." | not wired in this tree |
| F9 | Product summary | "How is each product doing?" | data type not collected yet |
| F10 | Claim summary | "What complaints / claims are accumulating?" | data type not collected yet |
| F11 | Review summary | "What are buyers saying?" | **blocked** — no official review API on most channels |
| F12 | Multi-commerce channel expansion | "Add Coupang / 11st / …" | skeletons only (Phase 3D) |

---

## 3. BE / FE responsibility split

For each feature: backend API, data model, frontend surface, user-facing
behavior, edge cases. APIs marked *(exists)* are already in the controller set;
*(new)* is not yet present.

### F1 — Channel / account connection
- **Backend API:** `GET /api/seller-accounts`, `GET /api/channels`, `POST /api/seller-accounts/file-channel` *(exists)*.
- **Data model:** `seller_accounts` (org_id, channel_id, auth metadata), `channels` *(exists)*.
- **Frontend:** `Channels.tsx` (list + status badges), `ChannelDetail.tsx`.
- **Behavior:** operator sees a card/row per connected account with channel, capability badges, last-synced, connection health.
- **Edge cases:** channel connected but no credentials yet; channel with empty capability set (skeleton-only) must render as "준비됨, 수집 미지원" not "connected & collecting"; account belonging to another org must never appear (org scoping).

### F2 — Credential registration / update
- **Backend API:** `POST /api/seller-accounts/{id}/credentials`, `GET …/credentials` (masked read) *(exists)*.
- **Data model:** `CredentialVault` AES-256-GCM blob per (org, seller_account); write-only intake, masked reads.
- **Frontend:** credential form within `ChannelDetail.tsx`.
- **Behavior:** operator enters channel-specific keys (Naver client_id/secret; HMAC keys for others); UI confirms "saved" without ever echoing the secret.
- **Edge cases:** re-submit overwrites; partial key set rejected; vault master key absent ⇒ fail-closed, surface a config error not a stack trace; **never** render stored secrets even masked-then-revealed.

### F3 — Connection status
- **Backend API:** `GET /api/seller-accounts/{id}/connection-status` *(exists)*.
- **Data model:** derived (last successful run + credential presence + capability set); no new table.
- **Frontend:** status badge on `Channels.tsx` / `ChannelDetail.tsx`.
- **Behavior:** CONNECTED / NEEDS_CREDENTIALS / UNSUPPORTED / ERROR, with last-checked time.
- **Edge cases:** CONNECTED must mean "credentials decrypt + capability exists," not merely "row present"; a channel that only supports file upload shows a distinct state, not a false green.

### F4 — Manual sync
- **Backend API:** `POST /api/seller-accounts/{id}/sync {"dataType":"ORDER_SUMMARY"}` *(exists, synchronous, returns `SyncRunView`)*.
- **Data model:** `sync_runs` row + `sync_cursors` (opaque per-channel cursor).
- **Frontend:** "지금 동기화" button on `ChannelDetail.tsx`; disabled while in-flight.
- **Behavior:** click → spinner → result toast with status / rows / rateLimited / nextRetryAt.
- **Edge cases:** in-flight double-click guarded; data type not in capability set ⇒ button hidden/disabled; 429 ⇒ show `nextRetryAt`, **do not auto-retry**; totalRows=0 rendered as "최신 상태(변경 없음)", not failure; scheduler must stay off during manual smoke.

### F5 — Sync run history
- **Backend API:** `GET /api/sync-runs?sellerAccountId=&dataType=&status=` *(exists)*.
- **Data model:** `sync_runs` (jobType, status, totalRows, failedRows, rateLimited, startedAt, finishedAt, errorMessage — already sanitized).
- **Frontend:** run-history table (new surface; not yet rendered) on `ChannelDetail.tsx` or a sub-tab.
- **Behavior:** chronological rows with status chip, row counts, duration, rate-limit flag, sanitized error.
- **Edge cases:** long-running paced run shows in-progress; never render raw payloads or tokens; errorMessage already sanitized at source — FE must not re-fetch raw bodies.

### F6 — Order / sales dashboard
- **Backend API:** `GET /api/dashboard/summary`, `GET /api/dashboard/channel-status`, `GET /api/orders` *(exists)*.
- **Data model:** `order_daily_summaries` keyed by (org_id, channel_id, summary_date) — upsert-by-(channel, date).
- **Frontend:** `Home.tsx` stat cards + `Orders.tsx` trend chart + transaction table.
- **Behavior:** 7-day order/sales trend, per-channel share, per-day rows; reads only aggregates.
- **Edge cases:** **must read live `order_daily_summaries`, not the mock-fallback** — this is the headline internalization gate; empty data ⇒ honest "수집된 데이터 없음" empty state; multi-channel sums must not double-count; date gaps rendered, not interpolated.

### F7 — Operational insights (rule-based first)
- **Backend API:** `GET /api/dashboard/summary` extended, or a new `GET /api/insights` *(new)*.
- **Data model:** derived from `order_daily_summaries` (+ later inquiries/claims); no LLM.
- **Frontend:** Insight Recommendation Card on `Home.tsx`.
- **Behavior:** plain rules — e.g. "오늘 주문 0건 (전일 대비)", "동기화 실패 1건", "미처리 문의 N건". Hedged, factual.
- **Edge cases:** never fabricate a trend from a single day; rule thresholds config-seeded, not hardcoded constants; degrade to "특이사항 없음" rather than empty.

### F8 — AI summary / report
- **Backend API:** `GET /api/reports`, generate action *(report endpoints partial; generation new)*.
- **Data model:** report records over collected summaries.
- **Frontend:** `Reports.tsx` list + preview card.
- **Behavior:** an operator-readable rollup (rule-based first; LLM later, separately authorized).
- **Edge cases:** must not claim AI analysis when running rule-based; no review/claim narrative until that data is actually collected; generation is out of MVP scope.

### F9 — Product summary
- **Backend API:** product data type fetch + `GET /api/products` *(new)*.
- **Data model:** product capability is CONFIRMED for Naver in the seed but **not implemented**; needs a fetch path + schema.
- **Frontend:** product list / per-product card (`ProductIssues.tsx` later).
- **Behavior:** per-product status once collected.
- **Edge cases:** do not open this fetch path before ORDER_SUMMARY UI is internalized (non-goal §6); schema preflight before any fetch code.

### F10 — Claim summary
- **Backend API:** claim/inquiry fetch + endpoint *(new; INQUIRY is NEEDS_VERIFICATION on Naver)*.
- **Data model:** new; depends on resolving the channel's claim/inquiry schema.
- **Frontend:** `Inbox.tsx` claim worklist.
- **Behavior:** accumulating claims by status.
- **Edge cases:** gated on schema verification per channel; do not guess the payload shape.

### F11 — Review summary
- **Backend API:** none possible for most channels — **review API UNSUPPORTED** on Naver and Coupang; **11st is the only official review/Q&A path** in the set (needs seller login).
- **Data model:** file-upload path + (where a review tree already exists) the Python review-ops analysis, kept separate.
- **Frontend:** `Inbox.tsx` review rows / upload fallback.
- **Behavior:** review data enters by file upload until/unless an official source is confirmed.
- **Edge cases:** **do not build review analysis until a review data source is confirmed** (non-goal §6); UI must capability-gate reviews, schedule API must reject them.

### F12 — Multi-commerce channel expansion
- **Backend API:** per-channel connector fetch paths behind feature flags *(skeletons exist; fetch new)*.
- **Data model:** reuses `CanonicalOrderSummary` → `order_daily_summaries`; connector abstraction stays channel-agnostic.
- **Frontend:** same `Channels.tsx` / dashboard surfaces, channel-parameterized.
- **Behavior:** flip a flag + supply keys ⇒ a new channel feeds the same dashboards.
- **Edge cases:** each channel = separate auth/rate-limit/schema problem; one channel must never block another; no new channel goes live before its schema is verified and Naver is fully internalized.

---

## 4. Recommended implementation order

Each phase ends in something an operator can see or rely on; no phase opens a
new data type or channel before the prior surface is proven against real data.

- **Phase 1 — Product skeleton & API contracts.** Freeze the request/response
  contracts for the existing controllers (seller-accounts, connection-status,
  sync, sync-runs, dashboard, orders) so FE wiring targets a stable shape.
  Decide the empty-capability rendering contract and the sanitized-error
  contract. *Deliverable:* contract doc + typed FE client, no behavior change.
- **Phase 2 — UI internalization of the existing Naver sync.** Replace
  mock-fallback with real backend reads for the Naver collection workflow:
  channel status, manual ORDER_SUMMARY sync, sync run history, rate-limit /
  `nextRetryAt` display. *Deliverable:* a seller can connect Naver, sync, and
  see real run results — no mock masking.
- **Phase 3 — Order / sales dashboard.** Wire `Home`/`Orders` to live
  `order_daily_summaries`; add the rule-based operational insight card.
  *Deliverable:* real trend + per-channel share + "what needs attention today."
- **Phase 4 — Scheduler & operational hardening.** Promote manual sync to
  scheduled collection (still opt-in), connector-failure alerts, pacing/backoff
  hardening, run observability. *Deliverable:* hands-off Naver collection with
  alerting. (Scheduler stays off until this phase deliberately enables it.)
- **Phase 5 — Product / claim / review expansion.** Add PRODUCT (CONFIRMED on
  Naver) first via schema preflight; then INQUIRY/claim once verified; review
  only if/when a source is confirmed (else upload path). *Deliverable:* more
  data types behind the same dashboard.
- **Phase 6 — Additional commerce channel connectors.** Turn skeletons into
  real fetch paths one channel at a time (Coupang order schema preflight is the
  most-public next candidate), each schema-verified, each feeding the same
  canonical dashboard. *Deliverable:* multi-channel collection.

### Deferred — Cafe24 provider onboarding (separate phase, not started)

**Decision (2026-06-14):** Cafe24 is a Phase-6 candidate but its real
integration is a **separate provider-onboarding phase**, not a code slice that
can be mixed into the current Naver-MVP flow. The Cafe24 skeleton in tree
(auth chain only, off by default — Phase 3D) is **not live-supported** and must
not be treated as such.

Real Cafe24 integration requires, before any connector fetch code:

- Cafe24 developer app creation.
- API scope / permission setup.
- Redirect URI / OAuth configuration.
- Mall operator approval / app installation.
- Authorization-code flow exchange.
- Access / refresh token storage in the credential vault.
- Connection-status + sync-run integration on the canonical path.
- Provider-specific live smoke (its own runbook, like the Naver one).

Until that phase is explicitly started:

- **Do not** run the Cafe24 live API.
- **Do not** enable the Cafe24 scheduler.
- **Do not** treat the Cafe24 skeleton as live-supported.
- **Keep Cafe24 out of the current Naver-MVP acceptance criteria** (§5).

Sequencing: this onboarding phase only begins after Naver is fully internalized
(Phases 1–3) and on explicit operator kickoff — the OAuth/installation steps
above are an onboarding project in their own right, distinct from wiring an
HMAC-keyed order fetch.

---

## 5. MVP scope (the cut line)

"Usable MVP" = a single seller can connect Naver, collect orders, and trust
what the dashboard shows. Must include, all against **real backend data**:

1. **Seller account list** — see connected accounts with channel + status.
2. **Naver account connection status** — CONNECTED / NEEDS_CREDENTIALS / ERROR, honestly derived.
3. **Manual ORDER_SUMMARY sync button** — one click, in-flight guard, result toast.
4. **Sync run history** — recent runs with status, row counts, duration, sanitized error.
5. **Order / sales dashboard from `order_daily_summaries`** — live aggregates, honest empty state.
6. **Rate limit / `nextRetryAt` display** — surfaced on sync result + run history; no auto-retry.
7. **Basic operational summary** — rule-based ("오늘 주문/매출", "동기화 실패", "미처리 문의"); LLM not required for MVP.

MVP maps to **Phases 1–3** plus the rate-limit surfacing from Phase 2. It is
explicitly **single-channel (Naver), order-only, no scheduler, no LLM.**

---

## 6. Non-goals (for now)

- **No additional commerce provider goes live yet** — skeletons stay off; Coupang etc. are Phase 6. **Cafe24 specifically requires a separate provider-onboarding phase** (developer app, OAuth, mall-operator install, its own live smoke) — see the deferred note under §4; its skeleton is not live-supported.
- **No scheduler-on live polling yet** — manual sync only until Phase 4 deliberately enables it.
- **No review analysis until a review data source is confirmed** — most channels have no official review API; reviews stay on the upload/report path.
- **No expanding data types before UI internalization** — PRODUCT/CLAIM wait until the ORDER_SUMMARY surface is real (Phase 2/3 done).
- **No LLM/RAG report generation in MVP** — rule-based insight first; AI summary is post-MVP and separately authorized.

---

## 7. Technical guardrails

These are load-bearing; violating them is how the product drifts into showing
things that aren't true.

- **No raw order / customer / product payloads in UI or logs.** Dashboards show
  aggregates; errors are sanitized at the source (already true for `SyncRunView`).
- **No tokens / secrets exposed** anywhere — not in UI, logs, run history, or
  commits. Credential reads stay masked; vault decrypt is in-memory at fetch time.
- **Scheduler stays disabled during any manual smoke** — manual and scheduled
  collection are never both live during verification.
- **Cursor reset only for a proven stale/corrupt cursor** — never as a routine
  "just re-pull everything" action.
- **Naver pacing stays enabled** — the min-request-interval floor + header-aware
  backoff that produced the clean smoke is not removed to "speed things up."
- **Connector abstraction stays channel-agnostic** — channels feed
  `CanonicalOrderSummary` → `order_daily_summaries`; no channel-specific logic
  leaks into the dashboard or FE.
- **Mock-fallback is a dev convenience, not a shipped state** — every MVP
  surface must be proven to read the real backend; a screen that silently falls
  back to `mocks.ts` is not "done."
- **Empty / caught-up is an honest state, not an error** — `totalRows=0` and
  no-data dashboards render explicit empty states.

---

## 8. Recommended next coding task

**Phase 1 → start of Phase 2: freeze the Naver collection API contracts, then
internalize the sync workflow UI.**

Concretely, the first coding slice should:

1. Pin the request/response contracts for the controllers the MVP depends on —
   `GET /api/seller-accounts`, `GET …/connection-status`, `POST …/sync`,
   `GET /api/sync-runs` — and the empty-capability + sanitized-error rendering
   contracts, as a typed FE client in `frontend/src/lib`.
2. Remove mock-fallback for the **Naver collection workflow only**:
   `ChannelDetail.tsx` connection status + manual ORDER_SUMMARY sync button +
   a new sync-run-history table, reading the real backend, with
   rate-limit / `nextRetryAt` surfaced and no auto-retry.

Rationale: this is the smallest step that converts the one live-verified path
(Naver ORDER_SUMMARY) into something an operator can actually drive from the UI,
and it removes the mock mask on the exact workflow we just proved end-to-end —
without opening any new data type, channel, or the scheduler. Order/sales
dashboard wiring (Phase 3) follows once the sync surface is real.

> Do not start coding from this document. The next coding turn requires its own
> scoped slice plan + approval, consistent with the phase-doc discipline.
