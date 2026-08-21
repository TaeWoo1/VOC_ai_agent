# Live-proof evidence index

> **What this is.** One row per live run that ever established something about SellerOps against a real
> marketplace account or a real database. It exists so that **no proof document is ever unlinked again.**
>
> **Why it exists.** On 2026-08-19 a repository audit found that Coupang `ORDER_SUMMARY` — first
> connection, first sync, idempotent re-sync, live-proven 2026-08-06 under approval `apr-01212e2da29a` —
> was recorded as `NEVER_IMPLEMENTED` in the capability audit, `❌ (인증 골격만)` in
> `docs/multi-channel-connector-roadmap.md` §4.1, and *"Auth skeleton only"* in
> `docs/channel_capability_ledger.md`. The code had contradicted all three for weeks. The single
> mechanical cause: **the proof document had zero inbound references anywhere in the repository**, so
> nothing ever prompted a canonical row to move. Details:
> `docs/channel_integration_completeness_audit_v1.md` §5.
>
> **What this is NOT.** Not capability truth — that stays `docs/multi-channel-connector-roadmap.md` §4.1.
> Not a promotion mechanism: a row here records *what a run showed*, never what the product supports.
> A row moving to `LIVE_PROVEN` here does **not** move 운영 지원 or 셀러 표기; those are product-owner
> decisions. If this index and §4.1 disagree, §4.1 wins on capability and this index is the place to look
> for why.

## Rules

1. **Every live run lands a row here in the same PR that lands its proof document.** A proof document
   with no row is the defect this file exists to prevent.
2. **A row must name its evidence file.** If the claim is not written down somewhere, it is not evidence.
3. **A proof document may only be deleted or merged away once its row here carries its whole unique
   claim** — date, channel, capability, commit, approval id, outcome, and any residual limit. This is the
   deletion precondition for documentation retirement.
4. `Outcome` is what the run *showed*, in the run's own words. Where a run proved less than its title
   suggests, the row says so.

## Legend

`PASS` — the stated thing was done end to end on a real account/database.
`PARTIAL` — some of the stated scope ran; the rest was deferred or not reached.
`BLOCKED` — the run stopped on a genuine blocker before proving its claim.
`INSTRUMENT` — a read-only calibration/recon sitting: it measured a screen, it did not exercise a product path.

---

## 1. Product capability proofs

| Date | Channel | Capability | Commit / env | Approval | Outcome | Evidence |
|---|---|---|---|---|---|---|
| 2026-06-14 | NAVER | ORDER_SUMMARY first sync + order-access probe | — | — | `PASS` (once) | `docs/archive/sellerops_phase3c_live_smoke.md` §0 |
| 2026-06-25 → 06-29 | Cafe24 | Phase C1 — board discovery: credential **refresh + single-use rotation write-back** + a read-only `/boards` call | dev backend + disposable DB | — | `PASS` — the read path's rotation contract proven on a real mall | `docs/sellerops_cafe24_c1_boards_live_verification.md` |
| 2026-06-25 → 06-29 | Cafe24 | ORDER_SUMMARY live verification; REVIEW read | dev backend + disposable DB, connector flag on for the run | — | `PASS` — promoted `NEEDS_VERIFICATION` → `CONFIRMED` in `Cafe24ApiConnector.capabilities()` | `docs/sellerops_cafe24_live_verification.md`, `docs/sellerops_cafe24_c2_order_summary_live_verification.md`, `docs/sellerops_cafe24_review_read_live_verification.md` |
| 2026-07-25 / 07-26 | NAVER | Initial review import — one guided monthly segment | disposable backend | — | `PASS` — 1 account · 1 segment · 62 new rows; guided single-CTA flow's first live evidence | `docs/action-window-runtime/naver-initial-review-import-live-proof-record.md` |
| 2026-07-30 / 07-31 | Cafe24 | REVIEW sync (board 4) — acquisition completion | PR #375 | — | `PASS` — fresh insert + idempotent replay on a real mall; 비밀글 fail-closed excluded. Residual: `reply_status` only ever observed `UNKNOWN` | `docs/sellerops_cafe24_review_acquisition_completion_live_proof.md` |
| 2026-07-31 | Cafe24 | INQUIRY sync (board 6), exact-window contract | PR #382, disposable env, real store | — | `PASS` — 1 in-window emitted, out-of-window excluded pre-mapper, C→ANSWERED, secret boundary live, idempotent replay. Supersedes the earlier HALT records | `docs/sellerops_cafe24_inquiry_read_live_proof.md` (HALT lineage: `..._halt.md`) |
| 2026-07-31 | Cafe24 | First-connection tutorial (onboarding) | `03c8c22`, disposable env, real store | fresh single-use | `PASS` | `docs/sellerops_cafe24_first_connection_tutorial_live_proof.md` |
| 2026-08-05 | NAVER | First connection + initial order sync + routine re-run | `main @ 2c9ecac`, disposable env | — | `PASS` / `PASS` / `PASS` (idempotency) | `docs/naver_live_first_connection_proof_v2.md` |
| 2026-08-05 | NAVER | Onboarding UX regression | — | — | `PARTIAL` — UX paths PASS; the connection + order-sync regression was **deferred by operator choice**, not re-run at that commit | `docs/naver_onboarding_ux_live_regression_proof_v1.md` |
| **2026-08-06** | **Coupang** | **First connection + first `ORDER_SUMMARY` sync + `PREPARING→CONNECTED` + idempotent re-sync** | **`main @ 59c2e6c`**, disposable backend `:18091` + disposable Postgres, pristine baseline verified | **`apr-01212e2da29a` / run `cp-781c4c7a2484`**, mode WRITE (credential=1, test=1, sync=1, re-sync=1), **preflight 9/9** | **`PASS`** — zero code modification; read-only GETs only (`returnShippingCenters` 400 → `ordersheets` 200 CONFIRMED); no secret/PII/provider-body leakage | **`docs/coupang_final_main_first_connection_order_routine_proof_v1.md`** ⚠ *the orphan that caused §5 of the capability audit* |
| 2026-08-06 / 08-07 | Coupang | Already-issued guided walkthrough regression | `main @ 7301eed`, observe-only | `apr-c00e52f0f093` / `run-502afae3b5e8` | `BLOCKED` — partial live evidence, then a genuine live-wiring blocker; the full FE-driven walkthrough was **not** driven live. 0 발급/재발급/삭제 clicks | `docs/coupang_already_issued_guided_walkthrough_live_regression_v1.md` |
| 2026-08-08 | Coupang | WING key **deletion** (guided destructive walk) | `main @ e798e910` | — | `PASS` for the guided walk (`COUPANG_WING_KEY_DELETION_LIVE_PASS`); agent click/type/submit = **0**. ⚠ the deletion outcome is **operator-attested, not agent-confirmed**. Tooling is feature-frozen and non-product | `docs/coupang_wing_key_deletion_live_v1.md` |
| 2026-08-12 | Coupang | WING guided issuance walk → **a real API key on a live account** | git `7a6c3a0a`, phase `COUPANG_WING_GUIDED_ISSUANCE_WALK`, agent `READ_ONLY` | `apr-4e2ba0cb2de9` / run `wt-d706105bcaa8`, WRITE-grade grant | `PASS` — the first guided walk ending in a real key | `docs/coupang_wing_key_issuance_live_e2e_v1.md` |
| 2026-08-13 | Coupang | Credential handoff (4 phases, each its own manifest + grant) | — | `apr-18727aabc978`, `apr-4a2b83d3e02b` | `PASS` under its own gate; ordering enforced in code (`WING_CREDENTIAL_CELLS_CALIBRATED=false` blocks a `CREDENTIAL_READ` manifest until phase 2 measured the screen) | `docs/coupang_credential_handoff_live_proof_v1.md` |
| 2026-08-13 | Coupang | Trusted-operator confirmation — does a live run start without a human press? | phase `COUPANG_WING_ISSUANCE_FORM_REVEAL`, agent `READ_ONLY` | `apr-1c33fb13a287`, `apr-d3e92322c761` (two sittings, same code/procedure/phase) | `PASS` — the run-level grant requires the press | `docs/trusted_operator_confirmation_proof_v1.md` |
| 2026-08-14 | Coupang | INQUIRY sync (official v5 `onlineInquiries`) | real account, 30-day re-sweep | `apr-98b667eb`, `apr-b8f9e191` | `PASS` — 2 real inquiries collected; re-sweep insert 0 / skip 2 / dup 0. Residuals: 7-day query cap; a real **429** at ~6 calls/s → paced to 4/s, and *that fix is not itself live-verified*; the routine chain stayed LIVE_UNPROVEN (both inquiries were already answered) | `docs/coupang_inquiry_live_proof_v1.md` |
| 2026-08-15 | Coupang | REVIEW acquisition (WING 상품평 backfill) | re-proven on corrected manifest `533cafc2` | `apr-06f26026cbc8` | `PASS` — 3 pages / 24 rows / **22 stored into an empty DB**; same-range re-sync `stored=0 skipped=22`, DB unchanged; **0 author values persisted**; paging performed by the seller (0 marketplace actions) | `docs/coupang_review_acquisition_v1.md` §6.6 |
| 2026-08-15 | Coupang | REVIEW **locate** `[쿠팡에서 보기]` | re-proven on merged main `f357fafe` | `apr-9503d9512dae` | `PASS` — `matches=1` twice independently, **0 stored** (DB unchanged at 22, 0 sync jobs), bindings spent, 0 marketplace actions. Caught a defect the offline suite could not: an `outline` on `<tr>` that **Chromium does not paint** | `docs/coupang_review_locate_ux_v1.md` §5.1 |
| 2026-08-17 | NAVER · Cafe24 · Coupang | **Review AI triage pilot** — vendor classification through the 3-channel gate | real PostgreSQL 15, first pilot org, backend from `.env.local`, V44 applied | (org-gated pilot, not a marketplace run) | `PASS` for the path: 35 rows considered/classified across 3 accounts, **0 AI-added marks this session**; key never reached the log; outside-channel (GMARKET) 404; Cafe24/Coupang `REPLY_*` → 400. The only live mark→ordering→funnel proof remains an earlier single NAVER row | `docs/workstreams/review_ai_triage_demo.md` §8 |
| **2026-08-19** | **Coupang + NAVER** | **Resident helper hosts both guided issuance walks on demand** (`--bridge-only`, idle → activate → release → idle) | `main` (PR #468 Coupang, PR #469 NAVER) | (product path — authorized by the seller's own 시작 press, not a CLI grant; see the approval contract §3) | `PASS` — one helper, both walks in sequence, **0 browser processes at idle**, one screened landing navigation per carrier, 0 marketplace clicks/types/submissions. NAVER proven to step 1 (`api_center_host` landing, `app_list` probe, 0/7); steps 2–7 need a seller who actually issues | `docs/resident_helper_on_demand_carrier_v1.md` §3a, §5a |
| **2026-08-20** | (no channel — SellerOps only) | **Agent draft model seam — a real LLM behind the LangGraph draft node** | local stack (`tools/dev/local-stack.sh`), backend from `.env.local`, org-gated to the demo org | (not a marketplace run — an org-gated vendor call, like the triage pilot) | `PASS` — `POST /api/agent/inquiry-draft` → `200 {available:true, category:"delivery_status_reply", …, providerVersion:"agent-draft/v1+openai:gpt-5-2025-08-07+agent-draft-prompt/v1+schema/v1+out4000+effort:low"}`. **The inquiry sent was written by the operator for this proof, not read from the seller's data** — the endpoint takes title/body in the request, so no real customer content left. Graph→seam→provider joint pinned offline (`springDraftProvider.test.ts`: `agent_draft_seam{providerKind:LLM}` → `inquiry_draft_generated{providerKind:LLM}`), because a browser proof of it depends on the OPEN queue having an item | `docs/decisions/agent-runtime-langgraph-llm-split.md` (Decision, 2026-08-20) |
| **2026-08-20** | (no channel — SellerOps only) | **`/agent` LangGraph run + HITL** — `interrupt` → checkpoint → approve → `Command({resume})` → record | local stack, demo org, agent-runtime 8787 up | (no marketplace run; execution-enabled false ⇒ nothing external) | `PASS` — trail `searched → prioritized → detailed → drafted` → checkpoint → `resumed_after_restart → recorded_approved`, "승인 기록됨 · 외부로 발송된 내용은 없습니다". Draft labelled **규칙 기반** (the capability was off for the org at that moment), which is the provenance-driven label proving itself in the conservative direction | this row |
| **2026-08-20** | Google OAuth (SellerOps auth) | **Fresh social sign-in → empty org → org isolation** | local stack | (not a marketplace run) | `PASS` — real Google OAuth sign-in; org `f5868cf8…` "데모 테스트" with **0 accounts / 0 reviews / 0 inquiries / 0 orders** while 데모 제조사 holds 3916 / 3220 / 1150 / 4. `/agent` account picker empty. **Onboarding NOT re-observed**: this Google account had onboarded before, so the 상호명 step correctly did not reappear. **No channel was connected** — that is an *operator-required connection action* (approval contract §, "A third class"), NOT a marketplace WRITE | this row |
| **2026-08-20** | (no channel — SellerOps only) | **Orders 0건 diagnosed: date-window, not code and not missing data** | local stack, demo org | (read-only) | `PASS` — same org, same endpoint: 최근 30일 → **0건**; 354-day window → **1150건 / 13,991,840원** across 43 non-zero days / 2 channels. DB: `order_daily_summaries` newest `2026-06-14` (67 days old), oldest `2026-05-03`; the API accepts up to 366 days, the screen offers 30. **No fix applied** — product-owner decision to re-judge after a real first sync on a new org | this row |
| **2026-08-20** | Coupang + NAVER | **Resident helper advertises and can serve FIVE carriers** — `issuance/coupang`, `issuance/naver`, `renewal/coupang`, `locate/coupang`, `import/naver` | `feat/full-product-integration-v1` | (product path — the seller's own press; nothing opens at activation) | **`PASS` — completed 2026-08-20 on a TTY-attached helper.** Pairing succeeded through the product flow (agent terminal showed the approval code; its own `/bridge/confirm` page showed confirmation number `E46-111`, matching the SellerOps screen; 허용 pressed). All FIVE then activated on that ONE helper, never restarted: `import/naver` 16:45:55 · `renewal/coupang` 16:52:49 · `locate/coupang` 16:54:30 · `issuance/coupang` 16:56:34 · `issuance/naver` 16:57:50 — each released afterwards, **0 helper-owned browsers at idle**. Renewal rendered `0 / 5` with renewal copy (it would have been `0 / 8` with no step detail before the fix); locate resolved its binding under the helper's own session then failed closed `PAGE_UNREADABLE`; NAVER reached `app_list` and step 1/7. Zero marketplace clicks/types/submissions, zero credential issuance | `docs/channel_integration_completeness_audit_v1.md` §1, §3 |
| **2026-08-20** | (no channel — SellerOps only) | **Inquiry reply publish — the seller UI reaches the WRITE, and stops at the gate** | local stack, demo org | (no marketplace POST — deliberately) | `PASS (to the barrier)` — `GET /api/inquiry-publish/capability` → `{executionEnabled:false, replyAdapterChannelCodes:[]}`, the fail-closed default, so the panel renders the manual hand-off and **no send control at all**; `GET /api/inquiries/{id}` now carries `channelCode`/`channelNameKo`/`draft{version,contentFingerprint,fingerprintAlgorithm}` — the fields the confirm binds to. **No `confirm-publish` call was made.** The two-press barrier, the fingerprint binding, the fresh `commandId`, and the stale-draft close are pinned by `InquiryResponsePanel.publish.test.tsx` | this row |

> **Defect found by the 2026-08-20 run, and fixed in the same PR.** Chaining the carriers through SPA
> navigation (the real seller path) surfaced one the offline suite could not: a settled walk whose marketplace
> window was still open held the single slot for the whole `windowGraceMs`, so the NEXT screen's carrier
> request was refused `OTHER_CARRIER_ACTIVE` — **fifteen minutes** on the product default. Observed live at
> 17:09:03 (renewal activated) → 17:09:29 (tab left) → 17:09:35 (`[쿠팡에서 보기]` refused) → 17:09:51
> (renewal finally released). The import carrier had hidden it, because it opens no window and so always
> released instantly. Fixed by a handover in `OnDemandCarrierHost.onClientAttachRequest`, gated on the same
> two readings the release rule already uses (no attached tab AND run settled); a run in flight or a watched
> carrier still refuses, and the old window is closed before the new carrier is built.

## 2. Calibration / recon instruments

Read-only sittings that measured a marketplace screen. They establish **selector and label readings**,
not product capability. Their outputs are frozen into product constants; the recorders themselves are
instruments with no promotion path (`docs/channel_integration_completeness_audit_v1.md` §2.1).

| Date | Channel | What was measured | Approval | Outcome | Evidence |
|---|---|---|---|---|---|
| 2026-08-08 | Coupang | WING no-key form classifier / credential cells | — | `INSTRUMENT` | `docs/coupang_wing_live_calibration_v1.md`, `docs/coupang_no_key_form_classifier_selector_recon_v1.md` |
| 2026-08-09 → 08-10 | Coupang | WING issuance form reveal · selector (re)calibration · stage-2 purpose labels · read-only recon | — | `INSTRUMENT` — several landings record **withdrawn** or **not established** conclusions; read each before citing | `docs/coupang_wing_issuance_form_reveal_v1.md`, `docs/coupang_wing_issue_selector_calibration_landing_v2.md`, `docs/coupang_wing_issue_selector_calibration_landing_v2.md`, `docs/coupang_wing_stage2_recon_evidence_landing_v1.md`, `docs/coupang_wing_stage2_recon_evidence_landing_v1.md`, `docs/coupang_wing_stage2_label_calibration_evidence_landing_v1.md`, `docs/coupang_wing_stage2_label_calibration_evidence_landing_v1.md`, `docs/coupang_wing_stage2_label_calibration_evidence_landing_v1.md`, `docs/coupang_wing_delete_selector_calibration_v1.md`, `docs/evidence/INDEX.md`, `docs/coupang_wing_reveal_*_v1.md` |
| 2026-08-11 | Coupang | WING guided auto-advance / consent pairing | `apr-6a3fba7e27c2` | `INSTRUMENT` — ⚠ consent pairing rests on an **aggregate conjunction**; the per-row census has never been run | `docs/resident_helper_on_demand_carrier_v1.md` |
| 2026-08-11 / 08-12 | Coupang | WING guided control highlight promotions (each promotable reading taken twice, agreeing integer for integer) | `apr-197d0cd2c9c7`, `apr-c13e4ee4a7c3` | `INSTRUMENT` — this is what the shipped walk points with (`WING_GUIDED_HIGHLIGHT_PROMOTIONS`); the separate `WING_HIGHLIGHT_LABELS` set remains **calibration-pending** and is *not* used by the walk | `docs/coupang_wing_guided_control_highlight_calibration_v1.md` |
| runs #4/#5/#6 | NAVER | API-center issuance locators — 4 fixed labels at `matchCount === 1` | — | `INSTRUMENT` — `open_app` deliberately **not** a highlight target (a live row anchor measured 44 matches) | `docs/channel_integration_completeness_audit_v1.md` §1; `collector` `api-issuance-calibration/*` |

## 3. Runtime / infrastructure proofs

| Date | Subject | Outcome | Evidence |
|---|---|---|---|
| 2026-07-27 | Acquisition supervisor ↔ live import boot | offline proof record | `docs/action-window-runtime/acquisition-supervisor-runtime-integration-proof-record.md` |
| 2026-07-27 | NAVER repeated review-operations loop | design + proof record for turning the live import vertical into a repeatable loop | `docs/action-window-runtime/review-operations-loop.md` |
| 2026-07-28 | Guided acquisition reliability | **offline-complete; live proof PENDING** a fresh single-use in-turn approval — recorded so the gap is not mistaken for a result | `docs/action-window-runtime/guided-acquisition-reliability.md` |
| 2026-08-21 | **Operator Graph v1 — local integration proof** (`feat/operator-graph-v1`, local PG 15.13 `sellerops`, org `7146c50f…d8e0`): Flyway V47 on real PostgreSQL; the derived-state chain over one org's **7,136 real customer utterances**; the four Operator scenarios; planner/judge OFF vs ON | **`PASS`, 5 blockers found and patched.** V47 applied (44ms, 4 indexes). Item analysis 640 → 7,136; issue memory 0 → 19 issues / 81 evidence; customer memory 0 → 7,136. Scenarios ①②④ answered with traceable evidence and correct coverage; **③ NOT PROVEN** — the org's OPEN work-item queue is empty (3,199 DISMISSED), the residual `demo_runbook_v1.md` §4 already records. ON vs OFF changed plan breadth and provenance labels but **no number, no evidence, no coverage verdict**. **No marketplace contact, no credential read, no WRITE added or executed.** Moves no §4.1 status | `docs/operator_graph_v1_local_integration_proof.md` |
| 2026-08-21 | **Operator Graph v2 — local integration proof** (`feat/operator-graph-v2`, local PG 15.13 `sellerops`, org `7146c50f…d8e0`): Flyway V48/V49/V50; Product Knowledge derived with **zero marketplace contact**; investigation divergence across three question classes with a live LLM planner; 15 paraphrases; planner OFF; the inquiry semantic classifier measured against `contracts/inquiry-issue/v1/RUBRIC.md` | **`PASS` on the runtime invariants; `LIMITATION` on repeat-inquiry detection.** `channel_products` 0 → **58** (a table empty since V1), `product_facts` 0 → 9 (all `DERIVED:TITLE`, parsed not guessed). **Three question classes produced three different investigations** — a policy question called no product tool in 15/15 runs; planner OFF ⇒ **5/5 free-text runs FAILED with no answer** while the Dashboard intent lane still ran. Repeat detection: **19/19 genuine inquiries classified, 0/3,201 spam** — and the corpus finding is the headline: **3,201 of this org's 3,220 "inquiries" are spam board posts**. RUBRIC G3 **미달** (4 repeated signatures, needs 5) ⇒ reported as a limitation, not as done. **9 defects found on real data, all patched with regressions.** **No marketplace contact, no credential read, WRITE tools 0.** Moves no §4.1 status — the new PRODUCT reads stay `NEEDS_VERIFICATION` | `docs/operator_graph_v2_local_integration_proof.md` |

| 2026-08-22 | **Inquiry Operational Truth & Sync Lifecycle Hardening — local proof** (`feat/inquiry-operational-truth`, local PG 15.13 `sellerops`, org `7146c50f…d8e0`): Flyway V51/V52 on real PostgreSQL; the seller's 2026-07-06 SPAM dismissals projected onto every current-truth read; the backfill/routine cursor lanes split and repaired in place; the source-observation primitive added | **`PASS`.** 홈 · Today Inbox · 리포트 · Operator 미답변 **3,208 → 9**, all four now counting one corpus. `item_analyses` current list 7,136 → 3,937 (`답변 필요` 3,208 → 9); 반복 문의 TOPIC 축 `품질 523 · 사이즈 473 · 배송 240 · 가격 195` → `색상 4 · 설치 3 · 제품정보 3 · 가격 2`. Recovery of the 3,199 pre-existing dismissals is idempotent (`excluded:3199` then `excluded:0`) and **reversible — proven live and round-tripped** (9→10→9). **Nothing deleted**: `inquiries` 3,229 and `customer_memory_entries` 3,220 unchanged. Four windowed cursors moved off the routine lane; ORDER_SUMMARY untouched. Repeat detection **stays a LIMITATION** — RUBRIC G3 still 4 vs 5, now bounded by a 21-inquiry genuine corpus rather than by contamination. **Absence → `SOURCE_REMOVED` remains structurally disabled.** **No marketplace contact, no credential read, no WRITE.** Moves no §4.1 status | `docs/inquiry_operational_truth_v1.md` |

### 3.1 Action Window R4 — the NAVER export/reply runs, one row each

Previously indexed here as a group. Split out in R5 so each run's date, outcome and evidence file stand
on their own — the precondition (rule 3) for retiring anything in that directory. Gate vocabulary
(`G3`, `G6`) is the r4-era approval ceremony, superseded by
`docs/sellerops_live_approval_contract.md`; it is kept verbatim because that is what the records say.

| Date | Run | Outcome | Evidence |
|---|---|---|---|
| 2026-07-13 | Read-only frame-aware surface probe | read-only surface observed; G6 consumed | `r4-probe-dispatch-record.md` |
| 2026-07-13 | Read-only row-shape probe | **hypothesis REFUTED** — the row-shape miss was not the cause; G6 consumed | `r4-rowshape-probe-dispatch-record.md` |
| 2026-07-13 | Export pilot Run 1 | **FAILED (fail-closed)**; G6 consumed | `r4-export-dispatch-record.md` |
| 2026-07-14 | Readiness-branch probe | **ROOT CAUSE CONFIRMED** — `empty_state_marker` precedence is the Run-1/Run-2 cause; the gate HALTed at rung 1 | `r4-readiness-branch-probe-dispatch-record.md` |
| 2026-07-14 | Run 2 — settle-fix verification | **NEGATIVE** — the settle fix did not resolve it; reproduced `FAILED` / 0-of-3 / `UNSUPPORTED_STATE` at `prepareSurface` | `r4-run2-settle-verification-dispatch-record.md` |
| 2026-07-14 | Run 3 — precedence-fix verification | **FIX CONFIRMED LIVE** — `prepareSurface` passed readiness, reached the human barrier at 2-of-3, `DOWNLOAD_TIMEOUT` | `r4-run3-precedence-fix-verification-dispatch-record.md` |
| 2026-07-15 | Run 4 — full export pilot | **COMPLETED 3-of-3 — the export path PROVEN LIVE end to end**: a real download, detected read-only, quarantine-validated | `r4-run4-full-export-pilot-dispatch-record.md` |
| 2026-07-16 | Run 5 — barrier + observation | EXECUTED; terminal `FAILED` / `DOWNLOAD_TIMEOUT` 2-of-3 — the **designed non-mutating shape**; G6 consumed | `r4-run5-barrier-observation-dispatch-record.md` |
| 2026-07-17 | Run 6 — session recovery | EXECUTED; **recovery LIVE-PROVEN**, non-mutating, terminal `FAILED`/`DOWNLOAD_TIMEOUT`; G6 consumed | `r4-run6-session-recovery-dispatch-record.md` |
| 2026-07-20 | Reply abort rehearsal Run 1 | EXECUTED — first supervised live NAVER reply abort; `OPERATOR_REPORTED / SUBMISSION_ABORTED / UNVERIFIED`, `run_b3e351d537b0` | `r4-reply-abort-rehearsal-run1-dispatch-record.md` |
| 2026-07-20 | Composer-abort Run 2 | EXECUTED — first to reach the **COMPOSER barrier**; `run_6ca0d6b71e2d` | `r4-reply-composer-abort-run2-dispatch-record.md` |
| 2026-07-20 | Composer-abort Run 3 | EXECUTED — clean composer-abort **plus a live finding that changed the milestone premise** (body-link); `run_535c358f…` | `r4-reply-composer-abort-run3-bodylink-finding.md` |
| 2026-07-20 | Review-id reconciliation | EXECUTED — two supervised READ-ONLY runs; the second resolved the target review by its **channel review id**, exactly one row, operator-confirmed | `r4-review-id-reconciliation-run-record.md` (scope: `r4-review-id-reconciliation-scope.md`) |
| 2026-07-24 | Run 7 — reply-state live proof | **COMPLETED 3-of-3 on attempt 3, REAL INGEST** (`871fccd`); G3 + G6 consumed | `r4-run7-reply-state-live-proof-dispatch-record.md` |

Assembled context for the above: `r4-evidence-pack.md` (2026-07-11, baseline `3cda125`) and the gate
record `r4-gate-record.md` (opened 2026-07-12, pilot seller = the operator's own dev NAVER account).

**Never executed** (choreography sheets that authorized nothing and were retired in R5, recorded here so
their non-execution is not mistaken for a missing result): the reply-submission abort-rehearsal dispatch
sheet and the live reply-run kickoff checklist. No live reply submission has ever been run — consistent
with §1's NAVER guided reply row (`OFFLINE_ONLY`).

### 3.2 Coupang WING calibration chain — what each unit established, and what now holds the truth

The WING guided walk was calibrated across ~18 units between 2026-08-06 and 2026-08-13. Several
**withdrew** an earlier claim; that is the most valuable part of the chain and is preserved here. The
authority for every reading is the **code constant**, not a document.

| Date | Unit | Established / withdrew | Where the truth lives now |
|---|---|---|---|
| 2026-08-06/07 | Live calibration + walkthrough binding | **PARTIAL LIVE PASS** (observe-only) on an already-issued account; zero 발급 click, zero secret/DOM/URL capture | `docs/coupang_wing_live_calibration_v1.md` (kept) |
| 2026-08-08 | No-key form classifier / credential cells | the no-key form's structural reading | `coupang-wing-classifier.ts`; `docs/coupang_no_key_form_classifier_selector_recon_v1.md` (kept) |
| 2026-08-09 | Issuance form reveal | a calibration claim that the **next unit withdrew** | `docs/coupang_wing_issuance_form_reveal_v1.md` (kept as the predecessor) |
| 2026-08-09 | Issue selector **recalibration** | **withdrew** the reveal unit's calibration claim after the 2026-08-09 attempt aborted at the checkpoint | superseded; landing v2 below |
| 2026-08-09 | Delete selector calibration landing | **WITHDRAWN 2026-08-09** — the capture was real but taken at `a666ad1`, *before* `buildFixedLabelLocateScript` gained its visibility filter at `a3ef479e` | `WING_DELETION_SELECTORS_CALIBRATED = false` in code; `docs/coupang_wing_delete_selector_calibration_v1.md` (kept) |
| 2026-08-09 | Delete calibration **withdrawal** | formalised the withdrawal; `role` had been documented as "as measured" when it was not | the `false` flag above |
| 2026-08-09/10 | Reveal headroom gate · observation-predicate repair · harness final check | offline repairs to the reveal instrument after the v2 run of 2026-08-09 | folded into the reveal driver |
| 2026-08-10 | Reveal Live v3 evidence landing | the **first Reveal Live run whose instrument actually saw Stage-2** | `docs/coupang_wing_reveal_live_v3_evidence_landing.md` (kept) |
| 2026-08-09/10 | Stage-2 read-only recon · recon evidence landing | the **first structural measurement** of the Stage-2 purpose-selection surface | `docs/coupang_wing_stage2_recon_evidence_landing_v1.md` (kept) |
| 2026-08-09/10 | Stage-2 purpose label calibration · option transcription | built the instrument and supplied the strings — **the purpose semantics remained UNMEASURED** | recorded; not promoted |
| 2026-08-10 | Stage-2 label calibration evidence landing | evidence from a granted live run; **the purpose labels are still not established** | `docs/coupang_wing_stage2_label_calibration_evidence_landing_v1.md` (kept) |
| 2026-08-11/12 | Guided control highlight calibration | measured the four controls the walk names but could not point at; **promoted** each reading, taken twice and agreeing integer for integer | `WING_GUIDED_HIGHLIGHT_PROMOTIONS` — **what the shipped walk actually points with**. The separate `WING_HIGHLIGHT_LABELS` set stays `LIVE_DOM_CALIBRATION_PENDING` and is *not* used (`docs/channel_integration_completeness_audit_v1.md` §2.1) |
| 2026-08-11 | Auto-advance / consent pairing | consent pairing proven only as an **aggregate conjunction**; the per-row census has never been run | `WING_CONSENT_PAIRING_LIVE_BASIS = AGGREGATE_CONJUNCTION_TRUE_2026_08_11_PER_ROW_CENSUS_NEVER_RUN` |
| 2026-08-12 | Vendor-method epistemic audit | filed every vendor-method claim under what actually supports it; **three corrections landed**; no new measurement | `docs/coupang_wing_vendor_method_epistemic_audit_v1.md` (kept) |
| 2026-08-12 | Key issuance live E2E | **a real API key on a live account** — the first guided walk to end in one | `docs/coupang_wing_key_issuance_live_e2e_v1.md` (kept) |
| 2026-08-13 | Guided flow polish | live walk: step ⑥ completes itself; the panel stays off the controls the seller reaches next | folded into the shipped walk |
| — | Three WING fields never resolved | `자체개발` and `호출 IP` matched **0**; `업체명` matched **8** on the real no-key form — these screens **are not in the flow** | audit `§2.2`; the engine records it directly |

The guided walk that ships today, and its idle→activate→release runtime, are
`docs/resident_helper_on_demand_carrier_v1.md`. The tutorial/bridge-wiring units that preceded it
(offline-synthetic FE↔agent wiring, the WING-resident tutorial, auto-advance) were retired in R5; that
document is their complete successor.
| 2026-07-27 | Acquisition supervisor ↔ runtime integration | proof record | `docs/action-window-runtime/acquisition-supervisor-runtime-integration-proof-record.md` |
| 2026-08-13 | Coupang live approval harness | `docs/sellerops_live_approval_contract.md` | — |

---

## 4. Repository audits (not live runs)

**Why this section exists, and why these rows are not in §1.** §1–§3 record **runs** — something that
happened against a real marketplace account, a real database, or a real runtime. A repository audit is
not a run: it establishes nothing new about a seller account, and its `Outcome` column would have
nothing to report in the run's own words (rule 4). But rule 1's *purpose* — **no evidence document is
ever left with zero inbound references**, the mechanical cause of the Coupang `ORDER_SUMMARY` record
staying wrong for two weeks — applies to an audit exactly as it applies to a run. So audits are indexed
here, in their own section, where nothing can mistake one for a live proof.

A row here records **what was true of the code at one commit**. It never moves a capability status, a
운영 지원 level, or a 셀러 표기; `docs/multi-channel-connector-roadmap.md` §4.1 keeps all three.

| Date | Commit audited | Scope | Outcome | Evidence |
|---|---|---|---|---|
| 2026-08-19 | `main` + PR #469/#471 | NAVER / Coupang / Cafe24 연결 · 로컬 에이전트 capability의 **도달 가능성** (`IMPLEMENTED_AND_WIRED` / `IMPLEMENTED_BUT_UNWIRED` / `ONLY_PROBE_OR_FIXTURE` / `NEVER_IMPLEMENTED`) | 19 capabilities 분류; Coupang `ORDER_SUMMARY`·order-access 오기록 **정정**; Coupang 갱신 walk가 첫 발급 walk로 mis-route되던 결함 발견 | `docs/channel_integration_completeness_audit_v1.md` |
| **2026-08-21** | **`main @ 2491f1ab`** | **Demo Baseline이 약속하는 6개 제품 capability** (수집 · 상품/채널 grouping · 미답변·부정·반복 triage · RAG 검색 · AI 답변 초안 · 주간 리포트) — 각각 구현 위치 · API/data/UI 연결 · 테스트 · 마지막 live proof | 수집 `LIVE` · 채널 grouping `LIVE` · 상품 grouping `DISCONNECTED` · 미답변/리뷰 triage `LIVE` · 반복 `DISCONNECTED`(리뷰)·`MISSING`(문의) · RAG `MISSING`(의도된 부재) · AI 초안 부분 `LIVE`(제품화면 미연결) · 주간 리포트 `IMPLEMENTED` 중 2곳 `BROKEN`. 단절 10건(A~J)을 **소실/단절 5 · 미결 결정 2 · 의도된 미구현 3**으로 분리하고 4단계 최소 복구 순서를 확정. **코드 변경 0** | **`docs/demo_baseline_recovery_audit_2026-08-21.md`** |
| **2026-08-22** | **`feat/operator-graph-v2` @ `c8165291`** | **Cafe24 inquiry ingest/sync path** — 재관측 시 UPDATE 여부 · 상태 변경 반영 · 삭제/비노출 감지 가능성 · snapshot vs incremental · absence 판정 안전 조건 · DB의 lifecycle 표현력 · 최소 reconciliation | 셀러가 **3,199건을 이미 `DISMISSED/SPAM`으로 처리**했으나 소비자 5곳이 그 판정을 읽지 않음. backfill 커서가 routine 커서를 점유해 정기 수집이 2025-03 창에 영구 고정된 **독립 결함** 발견. **last-observed 기록이 시스템 전체에 없어** absence 판정의 전제 자체가 부재. Cafe24 sweep은 authoritative snapshot임이 증명되지 않음(`end_date` 위반 관측 이력) ⇒ **absence→삭제 자동 판정 금지**. **코드 변경 0** | **`docs/cafe24_inquiry_source_reconciliation_audit_2026-08-22.md`** |
| **2026-08-22** | **`feat/demo-org-channel-knowledge` @ `9db0d96c`** | **Production-like Demo Org 조립 + Channel Knowledge v1** — vault key 진단 · demo org provenance · 취득 경로 semantics · 3채널 tutorial 회귀 · Agent 통합 | **vault**: credential은 봉인한 키로 열리고 key-ring이 회전을 지원, 지문으로 `KEY_MISMATCH`를 **증명**. Cafe24 credential **마켓 접촉 0회로 복구**(`OK`), NAVER는 키 재료 소실(`KEY_UNVERIFIABLE`) — 정직하고 실행 가능한 판정. **provenance**: REAL/DEMO_SEED/VERIFY_FIXTURE, auto-enabled filter로 기본 읽기는 REAL만. 홈 미답변 **9 → 1**, 부정 리뷰 **25 → 14**. 삭제 0건. **drift**: Cafe24 OAuth 스코프가 세 곳에 있었고 이긴 쪽이 `mall.read_product`를 빠뜨림 — 모든 Cafe24 연결이 틀린 집합에 동의해 왔음. 셋 다 수정 + 회귀에서 실패함을 확인한 테스트로 고정. NAVER EXPORT 취득 경로·NAVER `REVIEW_API` 부재 등재. **Channel Knowledge**: 3채널 × 8영역 54항목, 출처·검증일 필수, capability 답은 코드에서 합성. Operator tool 3개 전부 READ, **WRITE = 0 유지**. **마켓플레이스 접촉 0회** | **`docs/demo_org_and_channel_knowledge_v1.md`** |

---

## Known gaps in this index (recorded, not hidden)

- Rows before 2026-08 carry no approval id, because the Approval Manifest ceremony
  (`docs/sellerops_live_approval_contract.md`) postdates them. Their evidence files are still authoritative.
- The Action Window R4 dispatch records (§3) are indexed as a group rather than per run; their individual
  outcomes live in `docs/action-window-runtime/r4-evidence-pack.md`. Splitting them out is a prerequisite
  before any of those files is retired.
- `docs/sellerops_cafe24_*` records that predate dated headers are indexed by capability, not by date.
