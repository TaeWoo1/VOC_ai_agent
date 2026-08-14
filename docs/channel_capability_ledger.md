# SellerOps — Channel Capability Ledger

> **What this is.** A **living lessons ledger** across `channel × capability × acquisition mode ×
> status`, plus a column §4.1 does not carry: **what we've actually learned** per channel —
> available, blocked, verified, pending, or policy-limited, with the reason.
>
> **What this is NOT.** It is **not** the capability truth. The single source of capability truth is
> `docs/multi-channel-connector-roadmap.md` §4.1. This ledger **derives** its `status` column from
> §4.1 and **never promotes** it: a cell here may only move up *after* §4.1 moves, with evidence.
> If this ledger and §4.1 disagree, §4.1 wins (`CLAUDE.md` conflict priority) and this file is
> stale. The business/registration/credential cross-view stays in
> `docs/channel-capability-registration-matrix.md`; this ledger adds **lessons**, not registration
> columns.
>
> **Snapshot basis.** The `status` column mirrors §4.1 **as of 2026-07-31** (Cafe24 REVIEW live-verify
> #375 / Cafe24 INQUIRY live-verify #382; NAVER REVIEW as of 2026-07-15; all other rows as of
> 2026-07-07). Recovery baseline: `docs/sellerops_completion_checkpoint_v1.md` (`026c113`). Re-derive
> from §4.1 before citing at a later date — a recorded snapshot is not a standing fact.

---

## 0. Legend

**Acquisition mode** (`method`, roadmap §4.1) — how data arrives:
`API` > `EXPORT` (supervised) > `MANUAL` (file upload). "미확정" = not yet decided.

**Status** — the honest lesson-state for this `(channel × capability)`. Derived from §4.1's
4-stage ladder (연결 가능 → 구현됨 → 라이브 검증 → 운영 지원), collapsed into a lesson label:

| Status label | Meaning | §4.1 correspondence |
|---|---|---|
| **PRODUCTION** | Operationally supported; safe to show a seller as "supported" | 운영 지원 ✅ |
| **VERIFIED** | Live-verified at least once, but **not** always-on operations | 라이브 검증 ✅ |
| **IMPLEMENTED** | Code exists; not yet live-verified | 구현됨 ✅ (검증 ❌) |
| **PARTIAL** | Skeleton / boards-only / unwired — incomplete | 부분 |
| **PENDING** | Connectable or candidate, not built | 연결 가능 / 후보 |
| **BLOCKED** | Blocked by a named condition (policy, missing API, login wall, dual-tool conflict) | blocker present |
| **ABSENT** | Capability does not exist on the channel | 채널 자체 부재 |

**Never** display anything below `PRODUCTION` to a seller as "supported."

---

## 1. Ledger (channel × capability × acquisition mode × status × lesson)

> `status` here = §4.1 mirror (see snapshot basis). `lesson` is this ledger's own field: the durable
> takeaway + the current blocker/next-verification.

| Channel | Capability | Acquisition mode | Status | Lesson (available / blocked / verified / pending / policy-limited) |
|---|---|---|---|---|
| 공통 (all channels) | REVIEW · INQUIRY · ORDER_SUMMARY | MANUAL (file upload) | **PRODUCTION** | **Available.** The only production-supported path today. Per-channel golden fixtures still needed for form validation. |
| NAVER | ORDER_SUMMARY | API | **VERIFIED** | **Verified** once live (2026-06-14). Not operational: feature flag off, schedule off. Official auth mechanism matches. Solution Market registration is long-term, non-blocking. |
| NAVER | REVIEW | EXPORT (supervised) + MANUAL | **VERIFIED** | **Verified** export→ingest end-to-end once (2026-07-15, Run 4 — supervised, dev seller, local dev backend). **Policy-limited:** market-terms clarification still required before seller-facing operation. This is the Action Window reference precedent. |
| NAVER | INQUIRY | 미확정 (undecided) | **PENDING** | **Pending.** Acquisition method not yet decided; needs API-existence discovery. MANUAL only for now. |
| NAVER | REVIEW reply (write) | Action Window `REPLY_SUBMISSION` | **PENDING** | **Pending / offline.** Guided, human-performed, observe-only (SellerOps never submits). No official API → posting is **UNVERIFIED** by design. Live is gate-locked. Never label "답변 등록 지원". (roadmap §4.1 note, `contracts/action-window/v2/`) |
| Cafe24 (자사몰) | ORDER_SUMMARY | API (OAuth) | **VERIFIED** | **Verified** E2E PASS (token rotation + amount reconciliation). Seller's own mall only — **no proxy across malls.** Flag off; pilot-operation decision pending. |
| Cafe24 (자사몰) | REVIEW | API (board 4 구매후기) | **VERIFIED** | **Article capture verified live** (2026-07-30, PR #375): public-review fresh insert + idempotent replay on a real mall, 비밀글(secret) fail-closed excluded. Only `reply_status`=UNKNOWN was live-observed (raw not N/P/C → fail-closed; PENDING expectation withdrawn); N/P/C tokens stay tests-only. **Completion v1 (2026-07-31): raw_received / stored / secret-excluded / out-of-window / missing-`article_no` + reply_status distribution now instrumented, and idempotent replay (row immutable, cursor stable) re-proven; surfaces as `NEW_REVIEW` in the Operator Attention/VOC queue.** The secret / out-of-window / missing-`article_no` counters were all **0** this window, so their divergence (nonzero) behavior stays tests-only; only `reply_status=UNKNOWN` was live-observed. Flag off; seller's own mall only. |
| Cafe24 (자사몰) | INQUIRY | API (board 6 문의사항) | **VERIFIED** | **Article capture verified live** on the current work-queue sink (2026-07-31, PR #382, exact-window contract): 1 in-window emitted, out-of-window excluded pre-mapper, C→ANSWERED, `is_secret=true`, secret boundary live (Inbox includes / dashboard+analysis exclude), idempotent replay. board 9 1:1 excluded, never called. **public/N/P/UNKNOWN tokens + N→C transition = tests-only.** Flag off; seller's own mall only. Don't label "지원" (not production-supported). |
| ESM+ (GMARKET) | ORDER_SUMMARY | API | **IMPLEMENTED** | **Auth skeleton only**, no live verify. Provider onboarding requires 사업자등록 first, then provider inquiry. |
| ESM+ (GMARKET) | INQUIRY | API (skeleton) + MANUAL (Excel) | **PARTIAL** | **Unwired.** Read skeleton `NEEDS_VERIFICATION`; Excel import backend exists but not surfaced in FE. Only Gate-1 surface confirmed. Next = constrained read-only Gate-2 probe (separate approval). |
| ESM+ (GMARKET / AUCTION) | REVIEW | EXPORT (supervised) candidate | **PENDING** | **Policy-limited candidate.** Only the market tab surface confirmed (2026-07-07). Terms clarification required. Gmarket ↔ Auction must be **attribution-separated**. |
| Coupang | ORDER_SUMMARY | API (HMAC) | **IMPLEMENTED** | **Auth skeleton only.** Self-developed key path is the discovery target. **Blocked risk:** possible conflict from running two seller-tools simultaneously; parallel provider registration recommended. |
| Coupang | REVIEW | 공식 API 없음 · 공식 export 없음 · seller-owned WING 화면 READ_ONLY만 후보 | **BLOCKED** | **Re-confirmed 2026-08-14 by counting the whole documentation catalogue** (11 categories, no review endpoint) — the finding is "not in the list", not "not found". Operator confirmed WING **has** a review screen, offers **no official export**, and offers sellers **no way to reply** — so this channel is acquisition + VOC/analysis only, never a reply path. Public product-page scraping is **not a candidate**: Coupang's 이용약관 effective **2026-09-03** prohibits bot/spider/scraper collection in terms. Three READ_ONLY sittings (`docs/coupang_review_feasibility_v1.md`) established the structure — each review is its own `<tbody>`, anchored by the `노출상품ID (옵션ID)` column, with a 10-digit per-review identifier that is unique where present but covers **7 of 10** rows, and an 11-digit productId on all ten that is **not** a review key. **TECHNICALLY_POSSIBLE = CONDITIONAL_YES; POLICY = UNCLEAR.** §14 has since been **read in full** (2026-08-14, `docs/coupang_review_policy_gate_v1.md`): its 31 items are all selling conduct and it is **silent on automation** — the exposure is not access but *keeping a copy* (서비스 이용 정책 '시스템 부정 행위' 1)·3), 공통 §14③ 복사·복제·가공, 마켓플레이스 §13②). No clause permits it either. **Development = `PILOT_ALLOWED`, GA = `POLICY_GATED`** (product-owner decision 2026-08-14): a written Coupang answer gates **release**, not building, and the pilot is bounded by data minimization D1–D7 (seller-owned WING only; no author values; no raw HTML/DOM/screenshot; **no permanent review-body storage**; no external LLM; metadata + dedupe structure only). Known limitation: Coupang reviews may be **item-level, not seller-transaction-specific**. Nothing promoted. |
| Coupang | INQUIRY | API (official v5 `onlineInquiries`) | **VERIFIED** | **Verified live** (2026-08-14, `docs/coupang_inquiry_live_proof_v1.md`): 2 real inquiries collected through the official path, and a re-sweep of the same 30 days inserted 0 / skipped 2 / duplicated 0 with the stored rows untouched. **The schema question resolved into a choice, not just an answer:** Coupang has *two* inquiry APIs, and only `onlineInquiries` (상품 Q&A) carries no buyer PII — `callCenterInquiries` returns `buyerEmail`/`buyerPhone` and is deliberately never called. **Bounds:** the query window caps at **7 days** (a quarter of the order endpoint's 31), so an outage longer than that leaves a permanent hole recoverable only by re-backfill; and the sweep took a real **429** at ~6 calls/s against a documented 5/s ceiling — now paced to 4/s, a fix that is *not* itself live-verified. **The routine chain (work queue → proposal → draft → Action Window) is implemented and offline-tested but LIVE_UNPROVEN**: both collected inquiries were already answered, so no work item opened, and a live subject cannot be manufactured. Flag off. |
| 11번가 | ORDER_SUMMARY | API | **IMPLEMENTED** | **Auth skeleton only.** Seller-key availability (self-dev / direct key) unconfirmed; seller-tool/provider registration inquiry runs in parallel. |
| 11번가 | REVIEW · Q&A | API candidate | **BLOCKED** | **Policy-limited.** Holds the set's **only official review API**, but spec is behind a login wall; access conditions + scope unverified. |
| SSG | ORDER_SUMMARY | API | **IMPLEMENTED** | **Auth skeleton only.** Partner access required; partner API access unverified. |
| SSG | REVIEW | — | **ABSENT** | **Absent.** Channel has no review capability of its own (confirmed). |
| 오늘의집 (OHOU) | 전체 (all) | MANUAL only (API partner-restricted) | **PRODUCTION** (upload only) | **Policy-limited to MANUAL.** Direct API is partner-restricted. File upload verified; validate the real official export flow next. |
| 자사몰 (generic) | — | (channel-specific) | **PENDING** | Cafe24 is the built 자사몰 path (see above). Other 자사몰 platforms = new adapters, not yet scoped. |
| review apps | — | (channel-specific) | **PENDING** | Named destination; individual review-app connectors not yet scoped. Each = new adapter on the same canonical model. |
| future marketplaces | — | (per §4 procedure) | **PENDING** | Open-ended by design. New channel = new adapter + mapping; core model unchanged (roadmap §2). |

**One-line summary (for other docs to cite):** Production-supported = **file upload (all channels)
only.** NAVER/Cafe24 `ORDER_SUMMARY`, NAVER review supervised capture, and Cafe24 REVIEW (board 4) /
INQUIRY (board 6) read are **live-verified** (not always-on; supervised, single-account, disposable
backend). Everything else is implemented / skeleton / candidate — and every Action Window review path
sits behind a **policy-clarification gate**.

---

## 2. Channel-specific lessons (durable, append-only)

> Record what we learned that a status cell can't hold: *why* something is blocked, what a probe
> revealed, what a platform's policy actually says. Append with a date; never rewrite history —
> correct forward with a new dated line.

- **2026-07-15 — NAVER REVIEW (Action Window reference precedent).** Full export→ingest verified
  once under supervision (Run 4, dev seller, local dev backend). The Action Window pattern *works*
  end-to-end. Remaining barrier is **not** technical — it's market-terms clarification before any
  seller-facing / production step. Evidence: `docs/action-window-runtime/r4-evidence-pack.md` §8–17.
- **2026-07-07 — Coupang REVIEW.** Confirmed there is **no official review API**. This is the
  clearest case that "the product is not a scraper": we do not scrape the missing API — we decide
  between a verified official route and an Action Window, honestly.
- **2026-07-07 — 11번가 REVIEW/Q&A.** Holds the *only* official review API in the current channel
  set, but the spec is behind a login wall — availability ≠ access. Access conditions unverified.
- **2026-07-07 — SSG REVIEW.** The channel has no reviews at all. `ABSENT` is a real, recordable
  status — not a gap to fill.
- **2026-07-07 — 오늘의집 (OHOU).** Direct API is partner-restricted; MANUAL upload is the honest
  ceiling until the official partner export flow is verified.
- **2026-07 — Cafe24.** Order API is the strongest verified non-NAVER path (E2E PASS), and everything
  is **seller-own-mall only** — no cross-mall proxying.
- **2026-07-30 — Cafe24 REVIEW (board 4 구매후기).** Article capture verified live (PR #375): public
  fresh-insert + idempotent replay on a real mall, 비밀글(secret) fail-closed excluded **before** the
  mapper so secret title/body never reach DB/log. Only `reply_status`=UNKNOWN was live-observed (the
  raw token was not N/P/C → fail-closed, PENDING expectation withdrawn); N/P/C tokens are tests-only,
  and the secret-exclusion count + raw_received/missing-drop counts are unobserved (uninstrumented).
- **2026-07-31 — Cafe24 REVIEW acquisition completion v1.** Re-ran board-4 acquisition on the same
  evidence-grounded window (2026-06-29) + one idempotent replay: SyncRun SUCCESS, pre-existing row
  skipped (no insert/duplicate), row fingerprint + cursor unchanged, refresh credential rotated. Added
  sanitized full-accounting instrumentation (raw_received / stored / secret-excluded / out-of-window /
  missing-`article_no` + a closed-vocabulary reply_status distribution over stored rows) — so those
  counts are now instrumented and live-observed. Only `reply_status=UNKNOWN` appeared; the stored review
  surfaced as `NEW_REVIEW` in the Operator Attention/VOC queue and took no `item_analyses` row. `N`/`P`/
  `C` tokens and the secret-exclusion boundary stayed tests-only (this window carried neither). Evidence:
  `docs/sellerops_cafe24_review_acquisition_completion_live_proof.md`.
- **2026-07-31 — Cafe24 INQUIRY (board 6 문의사항).** The current work-queue sink is verified live
  (PR #382) under an **exact-window (Asia/Seoul, both-ends-inclusive)** contract: out-of-window rows
  drop pre-mapper, `is_secret` is preserved fail-closed, and the secret boundary is live-proven —
  secret inquiries stay in the Inbox work queue but are excluded from dashboard counts and analysis.
  The earlier 2026-06-25 (905-row) run used the now-superseded community-article sink and no longer
  represents the path. Only `C → ANSWERED` was live-observed; the N→C transition and public/N/P/UNKNOWN
  tokens stay tests-only.
- **2026-07-31 — Cafe24 REVIEW → Issue-Memory bridge + Cafe24 channel v1 complete.** Board-4 public
  reviews now promote into the canonical review store (honest CAFE24 provenance) and reach the existing
  Issue-Memory extraction / `issue` graph — no new pipeline, no new LangGraph, no migration (PR #387).
  A bounded reconciler promotes already-stored reviews with **no Cafe24 API call**; a real-source
  downstream proof promoted the stored #375 row and reached extraction (2 unknown units, 0 issues — the
  real body carried no rule-based complaint, so complaint-issue creation stays synthetic-proven).
  **Cafe24 pilot channel v1 is declared complete** (connect + orders/inquiries/reviews acquisition +
  exact-window/dedup + privacy + Attention/Issue-Memory + agent draft/brief; reply/comment **write**
  remains deferred, shown honestly). Still **not production-supported** (file-upload only). Baseline:
  `docs/sellerops_cafe24_channel_v1_completion.md`.
- **(structural) — Coupang / ESM+ ORDER_SUMMARY.** Provider/seller-tool registration can require
  **사업자등록 first** and may create **dual seller-tool conflicts**. Registration strategy is a
  parallel track, not a code blocker — see `docs/channel-capability-registration-matrix.md`.

---

## 3. How to update this ledger

1. A capability status changes **only** in `docs/multi-channel-connector-roadmap.md` §4.1, with an
   evidence link. Never here first.
2. Then mirror the new §4.1 state into §1's `status` column and re-date the snapshot basis.
3. Add the durable takeaway to §2 as a new dated line.
4. If a lesson affects registration/credentials, cross-link
   `docs/channel-capability-registration-matrix.md` rather than duplicating its columns.
5. New channel (`자사몰` variant, review app, future marketplace): add a `PENDING` row; it becomes a
   real status only after §4.1 declares it.
