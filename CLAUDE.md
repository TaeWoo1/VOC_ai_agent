# CLAUDE.md

Instructions for working in the active SellerOps repo.

## Product identity

**SellerOps is a multi-channel commerce operations AI agent for SME sellers/manufacturers.**
It carries operational work between human decisions — normalizing reviews, inquiries, orders, and
reports across the seller's channels. It is **not** a scraper dump, a browser click-bot, or a
VOC/cardnews project.

**Product assembly (2026-08-17, product-owner decision):** the product is **workflow-centric**
(홈 / 리뷰 / 문의 / 주문 / 채널 연결), not channel-centric; channel expansion is **paused** and the
seller-visible channel set is exactly **NAVER / Coupang / Cafe24** (a channel on screen is a channel
that is actually usable — `ProductChannels.java`, `lib/productChannels.ts`). Canonical:
`docs/product_assembly_ia_v1.md`.

Canonical product / strategy / state reference: `docs/sellerops_canonical_reference.md` (re-derive
state before citing at any later commit). **FE/IA is frozen as of A7 (2026-08-18)** —
`docs/product_assembly_ia_v1.md` §8; the local demo procedure is `docs/demo_runbook_v1.md`.

## Where development happens

- Normal work: **`sellerops/repo`** (this repo).
- Isolated feature work: **`sellerops/worktrees/<feature-name>/`** (created from this repo).
- **Never develop in `sellerops/runtime-holders/`.**

## Runtime holders

`sellerops/runtime-holders/` contains preserved runtime worktrees linked to the shared `aiagent/.git`
host. They hold live browser profiles, `.env` files, connections, and run state that exist in exactly
one place on disk and are **not** recoverable from git.

- Do not `git clean` there.
- Do not delete ignored files there.
- Do not move a holder with plain `mv` — use `git worktree move`, and only when explicitly approved.
- Do not read, print, or copy `.env` or connection secrets.

## Active source ownership

- `backend/` — Spring Boot service (Java, Gradle, Postgres/Flyway, JWT). **The only LLM egress** — now
  two capabilities, each with its own flag, key, transport, prompt and payload floor, and each provably
  unable to reach the other's (`review/triage/llm/` for review triage; `agent/llm/` for the agent
  runtime's draft seam).
- `frontend/` — React/Vite operations UI.
- `collector/` — TypeScript local agent: channel acquisition + Action Window (NAVER, ESM, Cafe24).
- `agent-runtime/` — standalone Node/TS **LangGraph** orchestration service (port 8787), and since
  2026-08-21 SellerOps's **AI Operator 실행 구조**: an `OperatorGraph` that interprets a goal **with an
  LLM planner and no deterministic fallback** (v2 — no plan, no run), chooses
  specialists (ProductOps · ReviewOps · InquiryOps · ReportOpsNode) and tools, keeps **evidence as
  first-class state**, judges what may be said, and stops on a bounded budget — over the four existing
  compiled graphs with human `interrupt`/resume, whose contracts are unchanged. Tools adapt onto Spring.
  A docker-compose service with its own CI status check and a live `/agent` route. It **holds no
  credential of any kind**: the draft, planner and judge models are all BACKEND capabilities reached
  with the operator's forwarded bearer, so "the backend is the only LLM egress" is still the property to
  check here. **The Operator's tool catalogue is 100% READ — there is no WRITE tool and a structural
  test refuses one** (`OperatorToolRegistry`, `operatorToolRegistry.test.ts`); credential handoff, Action
  Window commands and guided-submission mints are deliberately absent from it (`privilegedPlaneFence`).
  **Two lanes, and they are not the same product:** a button sends a closed `intent` and runs
  deterministically; a typed sentence is planned by the LLM or the run **fails**. Canonical:
  **`docs/sellerops_operator_graph_v2.md`** (제품 행동 계약 — Agent chat의 계획은 **반드시 LLM Planner**가
  세우고, 세울 수 없으면 run은 실패한다; 결정론 goal/keyword planner는 test·fallback 용도로도 존재하지
  않는다) · `docs/sellerops_operator_graph_v1.md`(구현·라이브 증명 기록, runtime semantics는 v2가 대체) ·
  `docs/decisions/agent-runtime-langgraph-llm-split.md`.
- `contracts/` — shared contracts (Action Window, review fingerprint).
- `tools/` — dev/support tooling.
- `docs/` — current SellerOps docs; `docs/archive/` holds historical material.

Map of how these connect, and which document owns each part: `docs/architecture.md` (pointer only).

## Safety fences

- **No CAPTCHA / 2FA bypass**, no auth bypass.
- **No hidden or chained platform clicks** — manual progress always remains available.
- **No automatic export / download / submit** as product behavior — only through an explicit,
  approved **human checkpoint**.
- **Official APIs first; the Action Window** pattern for user-confirmed platform actions: the seller
  clicks export/consent/download/submit on the marketplace; SellerOps only detects, validates, and
  processes the result.
- **Fail closed** on ambiguous, missing, or changed platform targets.
- **Sanitized output only** — never expose credentials, tokens, cookies, seller IDs, API keys, JWTs,
  raw page content, screenshots, exported files, or personal data. Internal timing (`eventTimeMs`)
  never surfaces; only `recencyBucket` may.

## Branch / PR rules

- Work from **feature branches** (never commit product changes directly to `main`).
- **No force-push** unless explicitly approved.
- **No live marketplace runs** without a fresh, single-use, in-turn approval. A plan, a prior
  approval, or a restored environment is never authorization. **Canonical contract:
  `docs/sellerops_live_approval_contract.md`** — the single source for the Standing Safety Contract,
  the Approval Manifest, and the approval lifecycle. Do not restate the rule elsewhere; link there.
  - **Default = one line.** When `bootstrap`/`preflight` has prepared and displayed a valid
    **Approval Manifest** (channel / account / surface / operation / mode / allowed actions on the
    record), the operator's entire single-use grant is the one line **"Seated and ready."**, bound
    to that manifest's `approvalId` + `runId` + scope. Ask for more only in the exceptions the
    canonical contract §3 lists (no manifest; account/operator/date unfixed; scope changed; process
    restarted; or a **WRITE/submission**, which always needs its own explicit mode-`WRITE` approval).
  - **Same-session, same-scope retries need no re-approval** (the live debug-loop). A change of
    channel / account / scope, a new session, or any code/branch/run/environment change ⇒ the
    approval is `REVOKED`; re-bootstrap for a new `approvalId` and a fresh grant.
- Never print secrets. Stage exact files — never `git add .`; never stage `.env`, `.profile/`,
  `.status/`, `.connections/`, `downloads/`, credentials, or real seller data.

## Canonical reading path

Six stops, in order. Everything else in `docs/` is evidence or lineage reached **from** these — if a
document is not on this path and nothing here links to it, it does not carry current truth.

| # | Stop | Owns | Document |
|---|---|---|---|
| 0 | orientation | what SellerOps is, who for, channel posture, user journey — **points, owns nothing** | `docs/product_operating_model.md` |
| 1 | **product scope / journeys** | identity, strategy, honest state, authority · the scope contract | `docs/sellerops_canonical_reference.md` · `docs/product-scope-v1.md` (**scope lock v1.13**) |
| 2 | **architecture** | the five runtimes, how they connect, the fail-closed gates — **a pointer page** | `docs/architecture.md` |
| 3 | **capability truth** | channel × DataType × method × status — **the single declaration** | `docs/multi-channel-connector-roadmap.md` §4.1 |
| 4 | **decisions** | ADRs and standing contracts | `docs/decisions/` · **`docs/sellerops_operator_graph_v2.md`** (AI Operator 제품 행동 계약 — LLM-first planning · Product Knowledge · 2026-08-21) · `docs/sellerops_operator_graph_v1.md` (실행 구조 · 구현 기록) · `docs/sellerops_live_approval_contract.md` · `docs/sellerops_local_agent_runtime_adr.md` · `docs/sellerops_local_to_pilot_connectivity_decision.md` (NAVER egress IP · Cafe24 callback) · `docs/coupang_review_policy_gate_v1.md` · **`docs/inquiry_action_flow_v1.md`** (문의 답변 흐름 — 채널별 WRITE capability 감사, 근거 있는 초안, **대상에 묶인 승인**과 전송 직전 재확인; Agent graph는 여전히 WRITE 0) · **`docs/inquiry_workflow_completion_v2.md`** (RAG retrieval correctness — 질문을 답할 수 있는 라이브러리가 0을 돌려주고 답할 수 없는 라이브러리가 1.00을 돌려주던 역전의 원인과 재설계; 사람이 정하는 `USER_CONFIRMED` 상품 연결; NAVER 두 subtype의 **서로 다른** 공식 답변 계약과 그로부터 나온 `OVERWRITE_WITHOUT_PROOF`) · **`docs/inquiry_operational_truth_v1.md`** (문의 operational lifecycle — 셀러의 SPAM dismissal은 current read 전부에서 존중되고, historical backfill은 routine cursor를 재정의하지 않으며, **absence는 삭제로 자동 판정되지 않는다**) · **`docs/seller_operations_knowledge_and_answer_memory_v1.md`** (Knowledge Scope 5종 — `CHANNEL_FACT`·`ORDER_STATE`는 **검색 코퍼스를 갖지 않고** 결정론적 출처에서 그때 읽는다; org 단위 **운영 정책**과 판매자가 실제로 한 **과거 답변**이 상품 지식과 같은 채점기를 쓰는 3-lane retrieval; **AI 초안은 Answer Memory에 들어가지 않는다**(구조 fence)) |
| 5 | **evidence** | every live run: date, channel, capability, commit, approval id, outcome | `docs/evidence/INDEX.md` |

**Demo 제품 정의:** `docs/demo_core_experience_v1.md`가 **데모로 보여줄 SellerOps**를 소유한다 —
첫 화면은 운영 Dashboard, 상품 화면과 Product Knowledge/RAG는 데모 필수, Agent는 어디서든, 그리고
Agent reasoning graph는 여전히 **WRITE 0**(marketplace WRITE는 승인 뒤 별도 Action Executor). 기존
canonical technical 문서를 덮어쓰지 않고 그 위에서 **화면과 경험의 순서**만 정한다. 매출 semantics는
채널마다 다르며 그 감사 결과가 §4.1에 있다. UX 감사와 재설계 원칙: `docs/frontend_ux_audit_v1.md`.

**Demo org / channel knowledge:** `docs/demo_org_and_channel_knowledge_v1.md` owns the canonical Demo
Org's **provenance contract** (`REAL` / `DEMO_SEED` / `VERIFY_FIXTURE`, default reads exclude synthetic),
the **vault key diagnosis contract** (a credential is opened with the key that sealed IT; `KEY_MISMATCH`
is proven by fingerprint, not guessed), and **Channel Knowledge v1** (platform knowledge — never
seller-specific policy). It moves no capability status; §4.1 keeps all three.

**Screens:** `docs/product_assembly_ia_v1.md` owns product IA, screen responsibility and the visible
channel set (supersedes frontend spec §5–§8·§17-A); `docs/sellerops_frontend_spec.md` owns frontend
principles (states, seller language, a11y, capability honesty, guided connection, Action Window screens).

**Scope-lock companions:** v1.9 Self-Pilot Runtime → `docs/self_pilot_runtime_v1.md`; v1.10 Auth + Growth
Instrumentation → `docs/auth_growth_instrumentation_v1.md`; v1.11 Service Readiness →
`docs/service_readiness_v1.md`.

**Derived views (never promote a status):** `docs/channel_capability_ledger.md` (channel lessons) ·
`docs/channel-capability-registration-matrix.md` (registration cross-view) ·
`docs/channel_integration_completeness_audit_v1.md` (per-capability reachability).

**Evidence rule.** Every live run gets a row in `docs/evidence/INDEX.md` in the same PR that lands its
proof. **Landing a proof document without a row there is a defect** — an unlinked proof is how Coupang
`ORDER_SUMMARY` stayed recorded as "인증 골격만" for two weeks after it was live-proven
(`docs/channel_integration_completeness_audit_v1.md` §5). A proof file may only be retired once its row
carries its whole unique claim.

**Status lives in workstream homes, not here:** Action Window runtime → `docs/action-window-runtime/`
(`HANDOFF.md`); Action Window frontend → `docs/workstreams/action-window-frontend/` (`progress.md`);
ESM live capture → `docs/esm/` (`live-capture-checklist.md`); review operations MVP →
`docs/workstreams/review_operations_mvp.md`; **review AI triage demo ("리뷰 AI 데모 준비" and the like) →
`docs/workstreams/review_ai_triage_demo.md`** (canonical entry point). A router carries paths, not state.

### Conflict priority

1. explicit product-owner decisions from the current task
2. `docs/product-scope-v1.md`
3. `docs/product_assembly_ia_v1.md` (IA / screens / visible channels), then `docs/sellerops_frontend_spec.md`
   (frontend principles)
4. `docs/sellerops_local_agent_runtime_adr.md`
5. `docs/multi-channel-connector-roadmap.md` §4.1 (living capability table)
6. the active slice document (`docs/slices/*` — index: `docs/slices/README.md`)
7. current implementation evidence
8. historical records under `docs/archive/` and the r4 evidence in `docs/action-window-runtime/`

Implementation evidence may reveal docs are stale, but must not silently redefine product intent —
**report the conflict** instead. That is exactly how the Coupang `ORDER_SUMMARY` correction happened.
For Action Window *status*, `docs/action-window-runtime/HANDOFF.md` wins.

### Assumption rule

Do not invent product, UX, channel-support, API, or security decisions. Verify repository facts
before relying on them. Surface product-owner decisions rather than resolving them. Classify every
unresolved point as: repository-verifiable, external-research required, or product-owner decision.
When uncertain, stop and report rather than guess.
