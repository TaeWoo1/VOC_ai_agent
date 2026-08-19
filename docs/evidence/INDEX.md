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

## 2. Calibration / recon instruments

Read-only sittings that measured a marketplace screen. They establish **selector and label readings**,
not product capability. Their outputs are frozen into product constants; the recorders themselves are
instruments with no promotion path (`docs/channel_integration_completeness_audit_v1.md` §2.1).

| Date | Channel | What was measured | Approval | Outcome | Evidence |
|---|---|---|---|---|---|
| 2026-08-08 | Coupang | WING no-key form classifier / credential cells | — | `INSTRUMENT` | `docs/coupang_wing_live_calibration_v1.md`, `docs/coupang_no_key_form_classifier_selector_recon_v1.md` |
| 2026-08-09 → 08-10 | Coupang | WING issuance form reveal · selector (re)calibration · stage-2 purpose labels · read-only recon | — | `INSTRUMENT` — several landings record **withdrawn** or **not established** conclusions; read each before citing | `docs/coupang_wing_issuance_form_reveal_v1.md`, `docs/coupang_wing_issue_selector_recalibration_v1.md`, `docs/coupang_wing_issue_selector_calibration_landing_v2.md`, `docs/coupang_wing_stage2_readonly_recon_v1.md`, `docs/coupang_wing_stage2_recon_evidence_landing_v1.md`, `docs/coupang_wing_stage2_purpose_label_calibration_v1.md`, `docs/coupang_wing_stage2_purpose_option_transcription_v1.md`, `docs/coupang_wing_stage2_label_calibration_evidence_landing_v1.md`, `docs/coupang_wing_delete_selector_calibration_v1.md`, `docs/coupang_wing_delete_calibration_withdrawal_v1.md`, `docs/coupang_wing_reveal_*_v1.md` |
| 2026-08-11 | Coupang | WING guided auto-advance / consent pairing | `apr-6a3fba7e27c2` | `INSTRUMENT` — ⚠ consent pairing rests on an **aggregate conjunction**; the per-row census has never been run | `docs/coupang_wing_auto_advance_action_window_v1_handoff.md` |
| 2026-08-11 / 08-12 | Coupang | WING guided control highlight promotions (each promotable reading taken twice, agreeing integer for integer) | `apr-197d0cd2c9c7`, `apr-c13e4ee4a7c3` | `INSTRUMENT` — this is what the shipped walk points with (`WING_GUIDED_HIGHLIGHT_PROMOTIONS`); the separate `WING_HIGHLIGHT_LABELS` set remains **calibration-pending** and is *not* used by the walk | `docs/coupang_wing_guided_control_highlight_calibration_v1.md` |
| runs #4/#5/#6 | NAVER | API-center issuance locators — 4 fixed labels at `matchCount === 1` | — | `INSTRUMENT` — `open_app` deliberately **not** a highlight target (a live row anchor measured 44 matches) | `docs/channel_integration_completeness_audit_v1.md` §1; `collector` `api-issuance-calibration/*` |

## 3. Runtime / infrastructure proofs

| Date | Subject | Outcome | Evidence |
|---|---|---|---|
| 2026-07-16 → 07-25 | Action Window R4 NAVER runtime — export, settle, precedence, barrier, session recovery, reply-state | run-by-run dispatch records; several are `PARTIAL` or abort rehearsals by design | `docs/action-window-runtime/r4-*-dispatch-record.md`, `docs/action-window-runtime/r4-evidence-pack.md` |
| 2026-07-27 | Acquisition supervisor ↔ runtime integration | proof record | `docs/action-window-runtime/acquisition-supervisor-runtime-integration-proof-record.md` |
| 2026-08-13 | Coupang live approval harness | `docs/coupang_live_approval_harness_v1.md` | — |

---

## Known gaps in this index (recorded, not hidden)

- Rows before 2026-08 carry no approval id, because the Approval Manifest ceremony
  (`docs/sellerops_live_approval_contract.md`) postdates them. Their evidence files are still authoritative.
- The Action Window R4 dispatch records (§3) are indexed as a group rather than per run; their individual
  outcomes live in `docs/action-window-runtime/r4-evidence-pack.md`. Splitting them out is a prerequisite
  before any of those files is retired.
- `docs/sellerops_cafe24_*` records that predate dated headers are indexed by capability, not by date.
