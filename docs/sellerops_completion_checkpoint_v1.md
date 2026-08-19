# SellerOps — Completion Checkpoint v1 (recovery baseline)

> **What this is.** A single point-in-time snapshot so that, after a long gap, the current
> implementation, live-evidence level, preserved branches, and next priority can be recovered
> **without re-reading the whole history**. It is a *recovery baseline*, not a new authority.
>
> **What this is NOT.** It does **not** redefine product intent, capability truth, or strategy.
> - Capability truth stays `docs/multi-channel-connector-roadmap.md` §4.1.
> - Product identity / strategy / scope-fence authority stays `docs/sellerops_canonical_reference.md`.
> - Channel lessons stay `docs/channel_capability_ledger.md`.
> This document *derives* from those and links them; if it ever disagrees, they win and this file is
> stale. Re-derive from git + §4.1 before citing at a later commit.

---

## 1. Anchor

| | |
|---|---|
| **Baseline commit (`origin/main`)** | `026c113` — Merge PR #384 (Inquiry Draft Preparation v1) |
| **Checkpoint date** | 2026-07-31 |
| **Latest Flyway migration on main** | `V34__inquiry_secret_and_source_update` (note: V29 was never used; Flyway gaps are allowed) |
| **Production-supported (seller-facing "지원") capability** | **File upload (all channels) only** — unchanged by everything below |

**Authority pointers (read these for truth, not this file):**
`docs/sellerops_canonical_reference.md` (identity/strategy/fences) ·
`docs/multi-channel-connector-roadmap.md` §4.1 (capability truth) ·
`docs/channel_capability_ledger.md` (lessons) ·
`docs/action-window-runtime/HANDOFF.md` (NAVER Action Window status-of-record) ·
`docs/sellerops_agent_runtime_migration.md` (agent-runtime).

---

## 2. Merged-PR ledger (as of `026c113`)

Newest first. Each row = PR → 2-parent merge commit on `main` → what it added. All merges are regular
2-parent merge commits (not squash/rebase).

| PR | Merge SHA | Summary |
|---|---|---|
| #384 | `026c113` | **Cafe24 Inquiry Draft Preparation v1** — agent-runtime `INQUIRY_DRAFT` domain: read one OPEN inquiry → rule-based draft → terminal human checkpoint, **no mutation / no send** (synthetic-proven only). |
| #383 | `b56bf1e` | **Cafe24 First Connection Tutorial v1** — read-only capability-check endpoint + 7-step wizard (live-proven on real 전선몰딩). |
| #382 | `14231a0` | **Cafe24 INQUIRY_READ Live Proof** — `is_secret` + source-aware upsert + secret exposure boundary; V34 (live-proven, exact-window). |
| #381 | `aff5333` | **Agent Runtime Operator Pilot v1** — fixed review sticky re-selection; 3-intent pilot on disposable DB. |
| #380 | `0cf4a8e` | **Agent Runtime Pilot Readiness v1** — backend-owned durable run store (V33 `agent_runs`) + exactly-once claim-before-mutate. |
| #379 | `222d295` | **Agent Runtime Product Integration v1** — agent-runtime becomes a central HTTP service the FE calls for all 3 intents. |
| #378 | `4d133de` | **Issue Memory Subgraph v1** — read-only operations brief (no checkpoint/LLM/write). |
| #377 | `f78e931` | **Review Reply Subgraph v1** — LangGraph review-reply subgraph reusing the backend rule-based reply domain. |
| #376 | `ddab1b6` | **Agent Runtime Migration v1** — Node/TS LangGraph orchestration service (`agent-runtime/`). |
| #375 | `0ae0900` | **Cafe24 REVIEW_READ Live Proof** — board-4 review read, 비밀글 fail-closed exclusion (live-proven). |
| #374 | `7638f10` | **Cafe24 Live Capability Proof v1** — Authorizer seam, board diagnostic, order pagination hardening, pinned Admin-API version (C1/C2 live-proven). |
| #373 | `0becfdc` | **NAVER Connection Strategy v1** — FE + docs; recon-based (no app-delete, 1-app/store). |
| #372 | `be571be` | **NAVER Per-Order Acquisition Foundation v1** — persists per-order data (V32 `channel_orders`); A5 live per-order sync proven. |
| #370 | `ce58099` | **NAVER Guided API Connection v1** — guided connection + seller-account create; Phase-1 live baseline proven at backend boundary. |
| #368 | `fbbc90a` | **Guided Acquisition Reliability** — 8 failure states + recovery (live-proven on real NAVER). |
| #367 | `520e85d` | **NAVER Review-Ops Loop** — plan-extension + after-ingest issue refresh (live-proven, overlay gap). |
| #366 | `b22857c` | **Account-Scoped Persistent Session** — per-account slot (V30) + durable session readiness. |
| #365 | `6549688` | **Acquisition Supervisor runtime integration** — channel-neutral supervisor + recoverable-session flow. |
| #355 | `6512f1e` | **Review Issue Memory** — issue extraction + memory (V31). |

Older PRs (#345–#364) are in `git log origin/main --merges`.

---

## 3. Common Agent Platform (`agent-runtime/`)

**What it is.** A standalone Node/TypeScript **LangGraph** orchestration service. LangGraph owns goal
parsing, context assembly, tool routing, the human checkpoint, and resume. LangChain Tools are thin
adapters onto the Spring backend, which remains the system of record for connectors, DB, transactions,
idempotency, policy, and audit.

**Hard invariants (structural, not just policy):**
- **No live LLM.** The only draft/suggestion provider is deterministic rule-based
  (`provider/DraftModelSeam.ts`, mirrors backend `RuleBasedInquiryProposalProvider` /
  `RuleBasedReviewReplyProvider`). A real model is a reserved seam behind its own gate + privacy review.
- **No channel API write, no external send.** Structural: read-only subgraphs have no send tool to
  reach; the write-capable inquiry path still stops at the backend's fail-closed publish gate + human
  checkpoint. Nothing in agent-runtime posts to a marketplace.
- **Sanitized.** Seller content (title/body/draft) never enters run-store snapshots or logs
  (`log.ts` `FORBIDDEN_KEY` denylist); tenant-scoped per request via backend `whoami`.
- **Production run store fail-closed.** `RunStoreKind=spring` (backend-owned, V33 `agent_runs`,
  optimistic lock + exactly-once claim) is required in production; file/memory stores fail closed at boot.

**The four LangGraph subgraphs** (`agent-runtime/src/graph/`, all `StateGraph`):

| Subgraph | Intent | Shape | Checkpoint? | Writes? |
|---|---|---|---|---|
| `inquiryGraph` | answer an inquiry | search → prioritize → detail → draft → **checkpoint** → record | yes (interrupt/resume) | backend proposal/publish gate (no channel send) |
| `reviewGraph` | reply to a review | search → prioritize → detail → draft → **checkpoint** → record | yes | backend review-reply domain (no send endpoint exists) |
| `issueGraph` | operations brief | prioritize → structured brief → DONE | no | none (read-only) |
| `inquiryDraftGraph` | prepare an inquiry draft | search → prioritize → detail → draft → END | no | none (read-only, transient draft) |

**HTTP surface** (`src/http/server.ts`): `/api/agent-runs` (start/resume/get), `/capabilities`,
`/health`, `/ready`. The FE `/agent` page calls this service for all intents.

**Proof level:** #376–#381 are **live-proven against a real Spring backend + disposable Postgres**
(fail-closed, restart-durable, idempotent, tenant-isolated, zero send/leak). #384 `INQUIRY_DRAFT` is
**synthetic-proven only** (live deferred).

### What is LangGraph vs what is NOT

- **LangGraph:** `agent-runtime/` (all four subgraphs above). Plus one *shadow* in the collector,
  `collector/src/action-window/initial-import/journey-shadow.ts` — a **trace/parity shadow** of the
  NAVER review-import journey, **not** an execution path.
- **NOT LangGraph:** the **Spring backend** (all domains — connectors, ingestion, inquiry/review work
  items, dashboard, analysis); the **collector production acquisition runtime** (Action Window export/
  ingest; `initial-import/journey-live.ts` + `journey-ports.ts` are plain TS state machines); the
  **frontend** (React/Vite). The collector's `@langchain/langgraph` dependency exists solely for the
  shadow trace.

---

## 4. Backend connectors & domains (Spring)

**Connectors** (`backend/.../connector/`): `naver` (implemented), `cafe24` (implemented),
`esm` + `esm/inquiry` (skeleton/unwired), **`coupang` (implemented — ORDER_SUMMARY + INQUIRY, both
live-verified; the "auth skeleton" wording here was corrected 2026-08-19, see
`docs/channel_integration_completeness_audit_v1.md` §5)**, `elevenst` / `ssg` (auth skeleton only),
`FileUploadConnector` (production), `MockApiConnector` (test). Connector flags default **off**; the
scheduler defaults off; credentials live in an AES-256-GCM vault.

**Domains of note:** inquiry proposal + work items (OPEN→…→COMPLETED), review triage + reply prep +
reply outcome, review issue memory, ingestion (source-aware upsert since V34), dashboard/analysis
(secret-excluding since V34), `agent_runs` (V33, backing the agent platform).

---

## 5. Channel capability matrix + proof level

**Proof-level vocabulary** (distinct from the §4.1 ladder):
- **live-proven** — ≥1 supervised real run on a real channel/mall, sanitized evidence doc.
- **synthetic-proven** — verified only on synthetic / disposable-DB fixtures; no real channel call.
- **tests-only** — a specific sub-behavior exists and is unit/integration-tested but never observed live.

All live proofs to date are **supervised, single-account, disposable/local backend** — never production,
never unattended. **운영 지원 (production-supported) is still file-upload-only.**

### Cafe24 (seller's own mall only — never a proxy/hub)
| Capability | Method | Proof level | Evidence / notes |
|---|---|---|---|
| ORDER_SUMMARY | API (OAuth) | **live-proven** | C1/C2 (#374): token rotation + amount reconciliation + idempotent replay (전선몰딩, disposable). `docs/sellerops_cafe24_c2_order_summary_live_verification.md`. |
| REVIEW read (board 4 구매후기) | API | **live-proven** | #375: public fresh-insert + idempotent replay; 비밀글 fail-closed excluded. Live-observed reply_status = **UNKNOWN only** (raw not N/P/C → fail-closed; PENDING expectation withdrawn). **N/P/C tokens = tests-only; secret-exclusion count + raw_received/missing-drop counts = unobserved (uninstrumented).** `docs/sellerops_cafe24_review_read_live_verification.md`. |
| INQUIRY read (board 6 문의사항) | API | **live-proven** | #382 (exact-window contract): 1 in-window emitted, out-of-window excluded pre-mapper, C→ANSWERED, `is_secret=true`, secret boundary live (Inbox includes / dashboard+analysis exclude), idempotent replay. **public/N/P/UNKNOWN tokens + N→C transition = tests-only.** board 9 (1:1) excluded, never called. `docs/sellerops_cafe24_inquiry_read_live_proof.md`. |
| First-connection tutorial | read-only capability check | **live-proven** | #383: 7-step wizard + capability endpoint on real 전선몰딩. |
| Inquiry answer draft | agent-runtime `INQUIRY_DRAFT` | **synthetic-proven** | #384: read-only draft → human checkpoint, no send/mutation. |
| REVIEW/INQUIRY **reply write** | comment/reply API | **not implemented** | Isolated spike + guided-handoff backend preserved on branches only (see §7). No `mall.write_community`, no comment POST performed. |

> **Known code-comment drift (not fixed here — docs-only change).** The shared enum javadoc
> `backend/.../community/CommunityReplyStatus.java` still reads *"Only N has been observed on a live
> Cafe24 response so far … every board-4/6 row sampled live to date was unanswered."* That is stale:
> #382 live-observed raw `C → ANSWERED` on board-6 INQUIRY (evidence
> `docs/sellerops_cafe24_inquiry_read_live_proof.md`), and #375 live-observed `UNKNOWN` (not N) on
> board-4 REVIEW. The frozen evidence docs are authoritative; the javadoc should be corrected in a
> later code change.

### NAVER SmartStore
| Capability | Method | Proof level | Evidence / notes |
|---|---|---|---|
| ORDER_SUMMARY | API | **live-proven** | Legacy once (2026-06-14); per-order foundation A5 (#372, 2026-07-29): 15 orders, daily↔per-order exact, PAYED→PAID, idempotent upsert. **Status transitions + non-PAYED/UNKNOWN normalization = tests-only.** |
| Guided API connection | guided + backend | **live-proven (backend boundary)** | #370 Phase-1: connection test PASS + first ORDER_SUMMARY sync 15 orders (disposable env). Not a guided-FE e2e walk. |
| REVIEW read | EXPORT (supervised Action Window) + MANUAL | **live-proven** | Run 4 (2026-07-15) export→ingest end-to-end; guided segment import (2026-07-25/26). Status-of-record: `docs/action-window-runtime/`. |
| REVIEW reply (write) | Action Window `REPLY_SUBMISSION` | **offline / gate-locked** | Guided, human-performed, observe-only; SellerOps never submits. No official API → outcome is always `OPERATOR_REPORTED` + `UNVERIFIED`, never `COMPLETED`. Never live-submitted. |
| Connection strategy | FE + docs | recon-based | #373: no app-delete (비활성화 only), 1-app/store, store-wide Secret. |
| INQUIRY | undecided | not built | MANUAL only; method not decided. |

### ESM+ (Gmarket / Auction)
| Capability | Method | Proof level | Evidence / notes |
|---|---|---|---|
| ORDER_SUMMARY | API | **not live** | Auth skeleton only. Provider onboarding needs 사업자등록 first. |
| INQUIRY | API skeleton + MANUAL (Excel) | **partial / unwired** | Read skeleton `NEEDS_VERIFICATION` (endpoint/fields/paging unverified) + Excel import backend (not surfaced in FE). Gate-1 surface confirmed only. Next = constrained read-only Gate-2 probe (separate approval). |
| REVIEW | EXPORT candidate | **blocked** | GMARKET selected-state contract unknown (REVIEW uses a dropdown, not a tablist); only the market-tab surface confirmed (2026-07-07). Gmarket ↔ Auction must be attribution-separated. |

Other channels: see §4.1. **Coupang is not an auth skeleton** — ORDER_SUMMARY and INQUIRY are both
implemented and live-verified (2026-08-06 / 2026-08-14), though neither is 운영 지원 (flags off); it has
no official REVIEW API (confirmed). 11번가 / SSG are auth skeletons and 오늘의집 is MANUAL-only; 11번가
holds the set's only official REVIEW API (behind a login wall), SSG has no REVIEW surface.

---

## 6. Channel v1 completion criteria (derived)

> Derived from the honesty ladder (§4.1 부록 A) + the NAVER v1 precedent (canonical §4). This is a
> synthesis for orientation; **"declare v1 closed" is still an open product-owner decision**
> (canonical §8 item 1) and is not asserted here.

A channel reaches **v1 (pilot-complete, still pre-production)** when all of:
1. **Guided connection** live-proven at least at the backend boundary (or MANUAL fallback documented).
2. **ORDER_SUMMARY** live-verified once, sanitized, idempotent replay shown.
3. **≥1 read surface** (REVIEW or INQUIRY) live-verified with idempotent replay **and** its privacy
   boundary (secret/PII exclusion) verified.
4. **Honest capability display** — nothing below `운영 지원` shown to a seller as "지원".
5. **Reply/write path defined** — implemented offline and explicitly gate-locked, OR documented as
   not-yet-scoped; never silently claimed.

**Against this frame today:** **Cafe24** meets 1–4 and has 5 defined-but-gated (reply write not
implemented; draft-only + spike). **NAVER** meets 1–4 (reply write offline + gate-locked = 5).
**ESM+** meets none yet (skeleton/blocked). **Production-supported** is a *separate, higher* bar that
no channel meets except file upload.

---

## 7. Preserved branches & risky uncommitted work

**Working tree at checkpoint:** clean — the only untracked path is `node_modules/` (gitignored build
artifact). **No uncommitted NAVER (or other) changes exist in this repo worktree.** (Runtime-holder
worktrees under `sellerops/runtime-holders/` are out of scope and must never be touched — canonical §7.)

**Preserved remote branches (pushed for backup at this checkpoint, no PR):**
- `feat/cafe24-inquiry-guided-reply-v1-backend` @ `d85664d` — Cafe24 Inquiry Guided Handoff backend (WIP).
  Verified: no secret/profile/node_modules; backend Java + tests only.
- `spike/cafe24-board6-reply-api-v1` @ `fa826a3` — isolated, gated, offline board-6 reply-API capability
  spike + contract audit. Verified clean. **Live comment POST remains deferred** to a fresh single-use
  approval; nothing in it was executed live.

**Already preserved via main (no push needed):** `fix/aw-popup-download-detection` (`783a9b4`) and
`feat/naver-guided-api-issuance-tutorial` (`ce58099`) — both already reachable from `origin/main`.

**Unmerged draft branch of note:** `feat/review-issue-action-loop` @ `0ade834` (Draft PR #371) — see §8.

---

## 8. PR #371 + migration renumber (V35)

**PR #371** (`feat/review-issue-action-loop`, Review Issue Triage → Guided Reply Action Loop v1) is a
**Draft, not merged**. It carries a migration named `V32__review_issue_feedback.sql`. On `origin/main`,
**V32 (`channel_orders`, #372), V33 (`agent_runs`, #380), and V34 (`inquiry_secret_and_source_update`,
#382) are all now taken.** Therefore, **before #371 can merge, its migration must be renumbered to
`V35`** (updated from the earlier V34 note after #382 claimed V34). This is recorded here only — **do
not touch #371 at this checkpoint.**

---

## 9. Priorities (next work order)

Direction only; **each step needs its own fresh approval**, and any live channel call is governed by
the canonical contract `docs/sellerops_live_approval_contract.md` (§3: default one-line
`Seated and ready.` against a prepared, displayed Approval Manifest; single-use).

> **UPDATE 2026-07-31 (`97ad192`) — Cafe24 pilot channel v1 is COMPLETE.** Priority 1 below (Cafe24
> REVIEW acquisition completion, #386) plus the REVIEW → Issue-Memory bridge + historical reconciler
> (#387) merged; Cafe24 v1 is declared complete (pilot-level, not production-supported). Baseline:
> `docs/evidence/INDEX.md`. **Cafe24 v1.1 deferred items** now lead: live
> complaint-issue creation, live `N`/`P`/`C` distribution + secret-review exclusion + fresh board-4
> insert, CSV dual-ingest hard fence, scheduled historical reconciliation, reply/comment write +
> Guided Handoff. **The next channel priority is now NAVER v1 completion (item 2).**

1. **Cafe24 REVIEW acquisition completion — ✅ DONE (#386/#387).** The remaining live gaps moved to
   Cafe24 v1.1 (see the completion baseline). Historical stored reviews now reach Issue-Memory.
2. **NAVER v1 completion** — close remaining NAVER gaps (status transitions + non-PAYED normalization
   tests-only; guided-FE e2e walk vs the proven backend boundary; reply submission stays gate-locked).
3. **ESM+ inquiry / API-first** — resolve the INQUIRY read skeleton `NEEDS_VERIFICATION` via a
   constrained read-only Gate-2 probe (separate approval), then decide API-first vs Excel import.
   *(2026-08-17: **PAUSED** — channel expansion paused; visible channels NAVER/Coupang/Cafe24 only. `docs/product_assembly_ia_v1.md` §2.)*

(Cross-reference the operational-capability roadmap in canonical §8 v1.7.)

---

## 10. Next unit — `Cafe24 Review Acquisition Live Proof v1` start conditions

> **STATUS: EXECUTED 2026-07-31 (Cafe24 Review Acquisition Completion v1).** Ran on the disposable
> `cafe24_phaseb` over the evidence-grounded window 2026-06-29 (board 4 only) + one idempotent replay.
> Outcome: SyncRun SUCCESS, idempotent skip of the pre-existing row (no insert/duplicate, cursor stable),
> new sanitized full-accounting instrumentation live-observed, credential rotation, Operator Attention/VOC
> exposure (`NEW_REVIEW=1`), zero analysis on community articles. **`reply_status` observed = UNKNOWN
> only**; `N`/`P`/`C` tokens and the secret-exclusion boundary **stayed tests-only** (this window carried
> neither) — a wider window from operator knowledge of the mall's history is required to advance those.
> Evidence: `docs/sellerops_cafe24_review_acquisition_completion_live_proof.md`.

**Precondition state (already true):** Cafe24 REVIEW read (board 4) is live-proven for public fresh-insert
+ idempotent replay + 비밀글 fail-closed exclusion (#375). ORDER_SUMMARY is live-proven (#374). Both use
the same OAuth; connector flags default off.

**What this next unit would prove live (the tests-only gaps):**
- reply_status `N` (→PENDING), `P` (→IN_PROGRESS), `C` (→ANSWERED) tokens observed on real **board-4**
  rows — the #375 run only ever saw `UNKNOWN` (raw not N/P/C). (Note: `C → ANSWERED` was already
  live-observed on **board-6 INQUIRY** in #382, but not yet on board-4 REVIEW.)
- 비밀글(secret) exclusion count observed on a window that actually contains a secret review.
- `raw_received` vs ingested vs missing-drop counts observed (the #375 code does not instrument them).

**Start conditions (all required):** _(historical record; the current standard for the approval itself
is the canonical contract `docs/sellerops_live_approval_contract.md` — a prepared/displayed Approval
Manifest + the one-line `Seated and ready.` grant, §3.)_
1. A **fresh single-use in-turn approval** naming channel = Cafe24, account (the disposable mall,
   e.g. 전선몰딩), date = the run day, operator = the seated user. A plan or prior approval is never
   authorization. ("Seated and ready" after an in-turn preflight that fixes those four facts counts.)
2. A **disposable DB** (real sellerops `:5432` untouched); read-only REVIEW, board 4 only; board 6/9
   not called; no order/product/reply write.
3. A board-4 window that actually contains a `C`/`P` row and a secret row (else the gap stays
   tests-only and the run must say so — no silent claim).
4. Sanitized evidence only; no writer/email/member_id/ip/order_id/secret content in logs or the record.
5. No `mall.write_community`, no OAuth re-consent, no comment/reply POST — this unit is **read** proof
   only. Reply-write remains on the preserved spike/guided-handoff branches, deferred (§7).

Environment note: the disposable `cafe24_phaseb` DB (`:55432`) may still be running from the #375/#382
stages — reuse or recreate as a disposable; never point at production.
