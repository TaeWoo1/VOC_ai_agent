# SellerOps Demo Runbook v1 (product assembly A7 — 2026-08-18)

> **What this is.** The one procedure for showing the assembled product (홈 / 리뷰 / 문의 / 주문 ·
> 채널 연결 / 설정) to someone who has never seen it, on a local machine, from the code on
> `feat/product-assembly-ia-v1`. It records what is **live-proven / test-proven / not proven** so the
> presenter never claims more than the product does. IA and screen responsibility live in
> `docs/product_assembly_ia_v1.md`; capability truth in `docs/multi-channel-connector-roadmap.md` §4.1;
> the AI pilot demo in `docs/workstreams/review_ai_triage_demo.md`. This file points; it owns nothing
> but the demo procedure.
>
> **Safety fences apply unchanged** (`CLAUDE.md`): no live marketplace run without a fresh single-use
> approval; no automatic export/download/submit; the seller performs every platform action.

## 0. Self-pilot mode (2026-08-18 — the product owner runs the product on their own seller accounts)

The demo procedure below assumes the seeded demo org. A **self-pilot** (initial connection → first
collection → routine operation, done by the seller themself) changes only these points:

- **Clean org.** Do NOT log in as `demo@sellerops.ai`. Create a fresh org once with `POST /api/auth/signup`
  (fields: `email`, `password` ≥ 6 chars, `name`, `orgName`) and log in with it at `/login` (replace the
  pre-filled demo credentials). Nothing from the demo/fixture data is visible from that org.
- **Real channels only.** Connect only the channels the seller actually uses, from `/connect`; the visible
  set stays NAVER / Coupang / Cafe24 and no seller account is seeded.
- **Agent required.** 첫 수집 (NAVER review import), guided reply and `[쿠팡에서 보기]` need the local
  agent (`collector`) paired over the bridge (`npm run dev:bridge` on the FE, agent on `47615`). Start the
  agent with `SELLEROPS_EMAIL/SELLEROPS_PASSWORD` of the **self-pilot org** — its defaults are the demo
  account, and an agent in another org fails three steps later (`naver-import-cta-live-runbook.md` trap 6).
  One agent hosts one carrier; the import carrier is
  `--action-window-initial-review-import --i-understand-this-opens-live-naver`.
- **Marketplace WRITE is forbidden until the product owner's explicit in-turn approval.** Import,
  locate and reply *preparation* are read-only; posting a reply or any other seller-center submission needs
  its own mode-`WRITE` approval (`docs/sellerops_live_approval_contract.md`).

### 0.1 Three-channel order and the command per channel (2026-08-18)

Order: **NAVER → Coupang → Cafe24**, one channel completed (connect → first collection → 홈/리뷰/문의/주문
checked) before the next, so a failure is attributable to one channel. Backend prerequisites (names only;
the demo backend has none of these): `SELLEROPS_VAULT_MASTER_KEY` + `SELLEROPS_VAULT_KEY_ID`,
`SELLEROPS_CONNECTOR_NAVER_ENABLED`, `SELLEROPS_CONNECTOR_COUPANG_ENABLED` (+ per-run
`SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID` from `tools/coupang-local/bootstrap.sh`),
`SELLEROPS_CONNECTOR_CAFE24_ENABLED` + `_CLIENT_ID` / `_CLIENT_SECRET` / `_API_VERSION` / `_REDIRECT_URI` /
`_RESULT_URL`; `SELLEROPS_COLLECT_SCHEDULER_ENABLED=false` (every live proof so far). Every live proof to
date ran on a disposable backend/DB — a long-lived self-pilot on the persistent DB is a **new** posture.

| Channel | Connect (seller, in the browser) | First collection | Command / trigger |
|---|---|---|---|
| NAVER | `/connect/naver` (Commerce API key form; ORDER only) or 리뷰: nothing to enter — the browser session is the connection | REVIEW = agent import carrier (seller downloads each monthly export in the agent's Chrome); ORDER = `/sync` button; INQUIRY = 파일 업로드 only | `cd collector && npx tsx src/cli/local-agent.ts --action-window-initial-review-import --i-understand-this-opens-live-naver` with `SELLEROPS_BASE_URL/_EMAIL/_PASSWORD` (self-pilot org) + `NAVER_REVIEW_URL`; trigger from `/connect/review-history` (도우미 연결하기 → 기간 선택 → 구간) |
| Coupang | `/connect/coupang` (WING access/secret key + vendor id; guided issuance walk optional) | INQUIRY (official `onlineInquiries`) + ORDER = `/sync` on `/connect/channels/:accountId`; REVIEW = seated WING walk (no API, no FE trigger); `[쿠팡에서 보기]` = locate carrier | `SELLEROPS_REVIEW_ACCOUNT_SLOT=<24hex> npx tsx src/cli/acquire-coupang-reviews.ts -- --i-understand-this-opens-live-coupang-wing` (via `tools/coupang-local/wing-review-acquire-bootstrap.sh` + preflight); locate: `npx tsx src/cli/run-coupang-review-locate-live.ts -- --i-understand-this-opens-live-coupang-wing` |
| Cafe24 | `/connect/cafe24` (mall id → OAuth consent, read-only scopes) | REVIEW (board 4) + INQUIRY (board 6) + ORDER = backend pull, no agent | `/connect/channels/:accountId` → 기간 backfill panel (`POST /backfill`) or `/sync` |

Recording targets while it runs: auth/OAuth/session expiry + recovery, agent/bridge disconnect/reconnect,
incremental sync / duplicate ingest, count drift, stale UI/state, cross-channel UX mismatch,
error/retry/reconnect UX, missing feedback/action events. Marketplace WRITE stays forbidden.

### 0.2 Self-Pilot Runtime v1 — days of routine with only the UI open (2026-08-18)

Design and honest state: `docs/self_pilot_runtime_v1.md`; scope decision `product-scope-v1.md` v1.9;
approval consequence `sellerops_live_approval_contract.md` §6a. What it changes for this runbook:

- **Backend once, before channel 1** (`backend/.env.local`, names only; then restart `bootRun`):
  `SELLEROPS_SELF_PILOT_ENABLED=true` · `SELLEROPS_SELF_PILOT_ORG_IDS=<self-pilot org uuid>` ·
  `SELLEROPS_SELF_PILOT_READ_GRANT_ID=<from tools/self-pilot/mint-read-grant.sh>` ·
  `SELLEROPS_COLLECT_SCHEDULER_ENABLED=true` (supersedes the "false in every proof" line above for this
  posture) · the connector + vault names of §0.1 · optionally `SELLEROPS_SELF_PILOT_TRIAGE_AUTO_ENABLED=true`
  next to the AI-pilot env for the same org. `SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID` is no longer
  needed for Coupang **reads** (the read grant opens them); it is still the only key for any WRITE.
- **After a channel becomes CONNECTED** nothing is pressed: within ~5 min the reconciler creates the 수집 설정
  rows for the data types its real connector serves (Cafe24: 리뷰·문의·주문; Coupang: 문의·주문; NAVER: 주문),
  due immediately, and the collect scheduler runs them on cadence (default 60 min). A row you turn off in
  수집 설정 stays off. 지금 수집하기 / 기간 backfill work as before.
- **Local agent** — replace the raw command of §0.1's NAVER row with the supervisor:
  `cp tools/self-pilot/self-pilot.env.example tools/self-pilot/.run/self-pilot.env` (fill the self-pilot org
  credentials, `NAVER_REVIEW_URL`; gitignored) → `tools/self-pilot/agent-supervisor.sh start` in a terminal
  you can see (first pairing code appears there; pair from `/connect/review-history` 도우미 연결하기) →
  after that `start -d` is fine (pairing persists). `[쿠팡에서 보기]`: `agent-supervisor.sh switch
  coupang-locate` (needs `COUPANG_WING_URL` in the env; the walk's ids are minted for you; you still press
  the in-browser grant), then `switch naver-import` back. `status` / `stop` / `logs`.
- **What now surfaces instead of failing quietly**: a channel whose credential/token stopped working shows
  재연결 필요 on `/connect` and under 홈 → 확인이 필요한 연결 (plus an alert), its 수집 설정 rows read
  "인증이 만료되어 자동 수집을 멈췄습니다…", and reconnecting (연결 확인 success / 갱신 / Cafe24 재동의) resumes
  them; an expired SellerOps session lands on `/login?expired=1` with "세션이 만료되었습니다".
- **Still the seller's hands**: NAVER / WING login in the agent's Chrome, every export click and page turn,
  the Coupang review acquisition walk (`wing-review-acquire-bootstrap.sh` + CLI — not schedulable), and
  every marketplace WRITE (unchanged: explicit mode-WRITE approval).

### 0.3 Browser-only new user (2026-08-18) — the seller's path, and the deployer's one-time prep

`docs/self_pilot_runtime_v1.md` §8. Two roles, deliberately separated:

**Deployer, once, before the service starts** (backend `.env.local`, names only): everything in §0.2's
backend list **plus** `SELLEROPS_SELF_PILOT_SCOPE=LOCAL_SINGLE_USER` (instead of `SELLEROPS_SELF_PILOT_ORG_IDS`)
and, if AI triage is wanted, `SELLEROPS_AI_TRIAGE_PILOT_ORG_IDS=*`. Start backend (`bootRun`) and frontend
(`npm run dev:bridge`). Nothing here is ever touched again for a new sign-up.

**Seller, in the browser only:**
1. `http://localhost:5173/signup` → 상호 · 이름 · 이메일 · 비밀번호 → 계정 만들기 → lands on **채널 연결**.
2. 채널 연결 → NAVER (`/connect/naver` for 주문 keys; 리뷰 = 도우미) → Coupang (`/connect/coupang`, WING keys)
   → Cafe24 (`/connect/cafe24`, mall id → consent). One channel at a time.
3. First collection: 지금 수집하기 on the channel page (or wait ≤5 min — routine schedules are created for the
   new org automatically) → 홈 shows 리뷰 · 문의 · 연결.
4. Helper for NAVER reviews / `[쿠팡에서 보기]`: **one command in a terminal, once** —
   `tools/self-pilot/agent-supervisor.sh start` — it asks for the SellerOps login (same as the browser) and the
   스마트스토어센터 리뷰 URL, then keeps running; pair from `/connect/review-history` 도우미 연결하기. (Carrier
   switching for `[쿠팡에서 보기]` is a recorded product gap.)
5. Come back daily: 홈 → 리뷰/문의/주문. Auth expiry shows as 재연결 필요; session expiry as 로그인 화면.

## 1. Start (two terminals, one browser)

```bash
# Terminal A — backend (Postgres `sellerops` on localhost:5432; Flyway owns the schema)
cd backend
set -a; . ./.env.local; set +a       # git-ignored; never print it
./gradlew bootRun                     # http://127.0.0.1:8080 — "Tomcat started on port 8080"

# Terminal B — frontend
cd frontend
npm run dev                           # http://localhost:5173 — proxies /api/* to :8080
```

- **A long-lived `bootRun` is a version pin** — restart it after pulling; it serves the classes it
  started with.
- Env the demo needs (`backend/.env.local`; names only — see `application.yml` for defaults):
  `SPRING_DATASOURCE_URL/USERNAME/PASSWORD` (default local `sellerops` DB), `SELLEROPS_JWT_SECRET`;
  for the AI pilot `SELLEROPS_AI_TRIAGE_PILOT_ENABLED=true`, `SELLEROPS_AI_TRIAGE_PILOT_ORG_IDS=<demo org
  uuid>`, `SELLEROPS_AI_TRIAGE_API_KEY=<vendor key>` (`review_ai_triage_demo.md` §3). Nothing else is
  required for the product surface.
- **Do NOT set** `VITE_AW_FIXTURE_PREVIEW` for a demo. It brings back the developer chrome (scenario
  selector, bridge diagnostics, simulated reply runtime) — see §5.
- `VITE_USE_MOCKS` stays unset/false: the demo runs against the real backend and the demo org's PG data.

## 2. Demo org

- Login: `http://localhost:5173/login?demo=1` — the form is pre-filled with the demo account
  (`demo@sellerops.ai`, seeded by `MockDataSeeder`; the page itself says the data is not real sales
  data). Press 로그인; nothing to type.
- Org "데모 제조사", operator "데모 운영자". Seller accounts on the three product channels
  (NAVER 스마트스토어 · 쿠팡 · 카페24 자사몰) plus a hidden G마켓 account the product surface never
  shows (visible-channel gate).
- Data shape as of 2026-08-18 (local PG): NAVER 3,880 reviews (15 확인 필요), Coupang 22 상품평
  (11 확인 필요), Cafe24 3 reviews; 3,208 unanswered inquiries of which most are Cafe24 board posts
  (spam-like community articles) — the 문의 count is honest but dominated by them; **no order data**
  (주문 shows 0 for every range); one prior NAVER reply-work row (approved draft) and whatever the
  presenter marks during the demo.

## 3. Screen order (the walkthrough)

| # | Screen | Show | Say |
|---|---|---|---|
| 1 | 홈 `/` | 오늘 확인하거나 조치할 일: 확인이 필요한 리뷰 N건 (channel shares), 답변이 필요한 문의 N건, 확인이 필요한 연결 N건; 참고 (메모리 · 리포트); 리뷰 수집 strip | "Every number here is the number the destination screen shows." |
| 2 | 리뷰 `/reviews/:naver?tier=NEEDS_ATTENTION` (press the NAVER share) | h1 리뷰 + workflow sentence; channel switcher; 확인 필요 순 list; tier chips 확인 필요 / 지켜보기 / 참고 / 전체; `AI 확인 필요` mark (pilot on) beside the rules chip | "Rules own the tier; AI only adds a suggestion." |
| 3 | 리뷰 detail (press a 확인 필요 row) | 답변 절: 처리 상태 → 대응 필요 → 답변 준비 panel (rule-based draft → edit → 초안 저장 → 승인 → 복사 → **직접 답변하고 기록하기**); then the pilot feedback controls; 내 답변 작업 at the bottom updates | "SellerOps never posts. The seller pastes the approved reply in SmartStore; here we only record that it was posted, unverified." |
| 4 | 리뷰 → 쿠팡 (switcher) | no 답변 절, `[쿠팡에서 보기]` present (needs the paired local agent — say so, do not press it in a plain demo) | "Coupang has no seller reply feature; the product does not pretend otherwise." |
| 5 | 문의 `/inquiries` | server count header; 답변 필요 → 답변함 → 전체; channel/period filters; a row → 문의 발췌, 분류 chips, "답변 방향을 제안할 수 없습니다" for rows without a work item | See §4: proposal is not demonstrable in this org today. |
| 6 | 채널 연결 `/connect` | three rows NAVER · 쿠팡 · 카페24 with one state word each and one verb; 정기 자료 가져오기; 리뷰 수집 실행 panel → `/connect/imports` (read-only without the agent: "로컬 에이전트가 연결되어 있지 않아 …", persisted 최근 가져오기 기록) | "A channel on screen is a channel that is actually usable." |
| 7 | 주문 `/orders`, 설정 `/settings` | honest empty orders; settings = facts and links, no toggles | — |

Suggested duration 10–12 minutes. Do not open `/agent`, `/memory`, `/reports` unless asked; they are
off the primary menu and not part of the assembled story.

## 4. Proof levels (say only what the row says)

| Surface / flow | Level | Evidence |
|---|---|---|
| Visible-channel gate, nav, Today Inbox counts = destination counts | test-proven + live-checked on local PG (A1–A2) | `docs/product_assembly_ia_v1.md` §6 |
| 리뷰 tier list, filters, URL sync, detail | test-proven + live-checked (A3, A7 walkthrough) | same |
| NAVER 답변 준비 from the 리뷰 detail (decision → draft → approve → copy → manual handoff → outcome record) | **test-proven; entry point re-hosted in A6, exercised live against local PG in the A7 walkthrough**; the underlying flow was live-proven on the old worklist surface (2026-07) | `docs/workstreams/review_operations_mvp.md` |
| NAVER guided reply (agent finds the row; seller submits) | live-proven once on the old surface (bridge + REPLY carrier); **not exercised since the move**; needs `npm run dev:bridge` + paired agent | `docs/action-window-runtime/HANDOFF.md` |
| `[쿠팡에서 보기]` locate run | live-proven 2026-08-15 (re-proved on merged main); needs paired agent + WING tab | `docs/coupang_review_locate_ux_v1.md` §5 |
| AI 확인 필요 mark (C2 pilot) | live-proven on the first pilot org (2026-08-17); org opt-in only | `review_ai_triage_demo.md` §8 |
| 문의 답변 방향 제안 (response workflow) | test-proven; **not demonstrable in the demo org** — work items exist only for connector-ingested inquiries and the demo org's one OPEN item is outside the 500-row feed window | this file |
| 리뷰 수집 (Action Window export run) | live-proven (NAVER, 2026-07); needs collector agent + `dev:bridge`; the plain demo shows the workbench read-only with persisted import history | `docs/action-window-runtime/HANDOFF.md`, `docs/workstreams/action-window-frontend/live-verification-protocol.md` |
| 주문 · 매출 | test-proven; no demo data | — |
| Cafe24 / Coupang connect wizards, OAuth | live-proven earlier (own workstreams); not part of the 10-minute path | `docs/slices/*`, roadmap §4.1 |

## 5. Segments that need the local agent (not in the plain demo)

- 리뷰 수집 실행 (`/connect/imports`): collector agent + `cd frontend && npm run dev:bridge`, pair via
  the dock, hard-reload. Live marketplace runs need a fresh approval (`docs/sellerops_live_approval_contract.md`).
- NAVER guided reply (agent hosting the REPLY carrier) and `[쿠팡에서 보기]`: same bridge; otherwise the
  panel offers the manual handoff and the locate button reports unavailability.
- Developer chrome (`VITE_AW_FIXTURE_PREVIEW=1`) is for the FE verification protocol only, never for a
  seller-facing demo.

## 6. Before every demo (5-minute checklist)

1. `git status` clean on the demo branch; backend restarted on it; frontend `npm run dev` fresh.
2. Log in via `/login?demo=1`; 홈 shows three items with numbers (not "지금은 확인할 수 없습니다").
3. `/reviews` NAVER: 확인 필요 count equals the 홈 share; open one row; the 답변 절 is present.
4. `/inquiries` list loads at once (the 500-row read went from ~4.4 s to well under 1 s on local PG in A7).
5. `/connect` shows exactly three rows, NAVER first.
6. No dashed "개발용" boxes anywhere (fixture preview off).

## 7. Known residuals (state them if asked)

- 문의 demo data is dominated by Cafe24 board spam; the response-proposal workflow has no reachable
  demo row (§4).
- 주문 has no data in the demo org.
- The 리뷰 detail shows two record-only control groups (답변 처리 상태 vs. pilot 분류 피드백); the
  answer to "which one do I press" is 답변 for work, 피드백 for teaching — copy says so, but it is
  still two groups.
- `/reviews` header prints "수집 기록 없음" for the NAVER account (its reviews arrived by upload,
  which is not a review import job).
