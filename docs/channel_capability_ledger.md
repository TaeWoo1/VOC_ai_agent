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
> **Snapshot basis.** The `status` column mirrors §4.1 **as of 2026-07-15** (NAVER REVIEW live-verify
> update; all other rows as of 2026-07-07). Re-derive from §4.1 before citing at a later date — a
> recorded snapshot is not a standing fact.

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
| Cafe24 (자사몰) | REVIEW · INQUIRY | API (board) | **PARTIAL** | **Blocked on article capture.** Board classification + storage exists; article capture not implemented. Board read confirmed once. Varies per mall. Don't label "지원". |
| ESM+ (GMARKET) | ORDER_SUMMARY | API | **IMPLEMENTED** | **Auth skeleton only**, no live verify. Provider onboarding requires 사업자등록 first, then provider inquiry. |
| ESM+ (GMARKET) | INQUIRY | API (skeleton) + MANUAL (Excel) | **PARTIAL** | **Unwired.** Read skeleton `NEEDS_VERIFICATION`; Excel import backend exists but not surfaced in FE. Only Gate-1 surface confirmed. Next = constrained read-only Gate-2 probe (separate approval). |
| ESM+ (GMARKET / AUCTION) | REVIEW | EXPORT (supervised) candidate | **PENDING** | **Policy-limited candidate.** Only the market tab surface confirmed (2026-07-07). Terms clarification required. Gmarket ↔ Auction must be **attribution-separated**. |
| Coupang | ORDER_SUMMARY | API (HMAC) | **IMPLEMENTED** | **Auth skeleton only.** Self-developed key path is the discovery target. **Blocked risk:** possible conflict from running two seller-tools simultaneously; parallel provider registration recommended. |
| Coupang | REVIEW | 공식 API 없음 (confirmed) — method 미확정 | **BLOCKED** | **Blocked: no official review API** (confirmed). Path undecided — either a verified official route or Action Window. |
| Coupang | INQUIRY | API candidate (CS API exists, schema unread) | **PENDING** | **Pending.** CS API exists; schema not yet inspected. |
| 11번가 | ORDER_SUMMARY | API | **IMPLEMENTED** | **Auth skeleton only.** Seller-key availability (self-dev / direct key) unconfirmed; seller-tool/provider registration inquiry runs in parallel. |
| 11번가 | REVIEW · Q&A | API candidate | **BLOCKED** | **Policy-limited.** Holds the set's **only official review API**, but spec is behind a login wall; access conditions + scope unverified. |
| SSG | ORDER_SUMMARY | API | **IMPLEMENTED** | **Auth skeleton only.** Partner access required; partner API access unverified. |
| SSG | REVIEW | — | **ABSENT** | **Absent.** Channel has no review capability of its own (confirmed). |
| 오늘의집 (OHOU) | 전체 (all) | MANUAL only (API partner-restricted) | **PRODUCTION** (upload only) | **Policy-limited to MANUAL.** Direct API is partner-restricted. File upload verified; validate the real official export flow next. |
| 자사몰 (generic) | — | (channel-specific) | **PENDING** | Cafe24 is the built 자사몰 path (see above). Other 자사몰 platforms = new adapters, not yet scoped. |
| review apps | — | (channel-specific) | **PENDING** | Named destination; individual review-app connectors not yet scoped. Each = new adapter on the same canonical model. |
| future marketplaces | — | (per §4 procedure) | **PENDING** | Open-ended by design. New channel = new adapter + mapping; core model unchanged (roadmap §2). |

**One-line summary (for other docs to cite):** Production-supported = **file upload (all channels)
only.** NAVER/Cafe24 `ORDER_SUMMARY` and NAVER review supervised capture are **live-verified** (not
always-on). Everything else is implemented / skeleton / candidate — and every Action Window review
path sits behind a **policy-clarification gate**.

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
- **2026-07 — Cafe24.** Order API is the strongest verified non-NAVER path (E2E PASS). Reviews/
  inquiries via board API are blocked on **article capture**, and everything is **seller-own-mall
  only** — no cross-mall proxying.
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
