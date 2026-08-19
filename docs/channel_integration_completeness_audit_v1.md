# Channel integration completeness audit v1 (2026-08-19)

**What this is.** A capability-by-capability audit of NAVER / Coupang / Cafe24 connection + local-agent
features, tracing each one along the FULL chain — user entry → frontend → bridge/backend request → resident
or flag-selected carrier activation → real driver/connector → result back to the UI — and classifying it as
`IMPLEMENTED_AND_WIRED` / `IMPLEMENTED_BUT_UNWIRED` / `ONLY_PROBE_OR_FIXTURE` / `NEVER_IMPLEMENTED`.

**Rules the audit held itself to.** A file existing, or a test passing, is not `WIRED`. `WIRED` means the
chain closes from a control the seller can press. Fixture / synthetic / selector-calibration paths are counted
separately from product runtime. **Past live proof** and **current reachability on merged `main`** are two
columns, never one — several capabilities are live-proven AND currently unreachable from the resident helper.

Capability truth for channel × DataType stays in `docs/multi-channel-connector-roadmap.md` §4.1. This document
audits **reachability**, and does not redefine any capability §4.1 declares.

---

## 1. The table

Legend — *Live proof level*: `LIVE_PROVEN` = run on a real seller account; `LIVE_CALIBRATED` = the selectors /
readings were measured live, the end-to-end walk was not; `OFFLINE_ONLY` = tests and fixtures only.

| Capability | Past state | Current wiring (merged main + this PR) | Live proof level | Action taken | Residual |
|---|---|---|---|---|---|
| **NAVER — 신규 API issuance guided walk** | driver + engine + session complete since the issuance phase; the ONLY host was `run-api-issuance-live-naver.ts`, gated on an operator-owned `NAVER_API_CENTER_URL` | was `IMPLEMENTED_BUT_UNWIRED` in the resident runtime → **`IMPLEMENTED_AND_WIRED`**: `/connect/naver` → `aw_attach{issuance,naver}` → `activateNaverGuidedWalk` → `LazyNaverIssuanceDriver` → `NaverIssuanceDriver` → run view back to the FE | `LIVE_PROVEN` (2026-08-19, this PR: landing `api_center_host`, probe `app_list`, 0/7 timeline, release back to idle) | **wired** — existing driver/engine/session reused verbatim; only a lazy opener + a landing constant + the activator list added | the walk was proven to step 1; steps 2–7 need a seller who actually issues an app |
| **NAVER — existing app / credential path** | reducer path + `NAVER_EXISTING_APP_TUTORIAL` + runtime-observed `appBranch` | `IMPLEMENTED_AND_WIRED` — the runtime reads the application list and publishes `appBranch`; the FE dispatches `ISSUANCE_APP_BRANCH_OBSERVED` and the reducer routes to `existing_credential_entry` | `LIVE_CALIBRATED` (the `open_app` transition-observe target was measured live; the existing-app completion was not run end to end) | none needed | no live run of the existing-app branch to completion |
| **NAVER — issuance selector probe / highlight** | `probe-issuance-selectors.ts` (read-only recorder) + `visual-recon-adopted` | `IMPLEMENTED_AND_WIRED` — four fixed-label locators (`create_app`, `api_group`, `application_id`, `application_secret`) derived from the adopted set, re-scored through the frozen adoption gate | `LIVE_CALIBRATED` — `matchCount === 1` on the real API center, runs #4/#5/#6 | none needed | `open_app` is deliberately NOT a highlight target (a live row anchor measured 44 matches) — it is navigation guidance + an observed transition; `return` is text only |
| **NAVER — credential / permission / IP probe** | advertised call IP from the backend setup view; order-access probed by the connection test | `IMPLEMENTED_AND_WIRED` | `LIVE_PROVEN` (order-access, 2026-06-14) | none | **this machine's env has `SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS` unset**, so the guided screen honestly says "고정 호출 IP가 아직 설정되지 않았습니다" while Coupang's is set. Config, not code |
| **NAVER — first ORDER sync** | backend API connector | `IMPLEMENTED_AND_WIRED` | `LIVE_PROVEN` once (2026-06-14) | none | scheduling flag off; not production-supported (§4.1) |
| **NAVER — review import (guided segment)** | Action Window import carrier | `IMPLEMENTED_AND_WIRED` **to its own boot** (`--action-window-initial-review-import` + `--i-understand-this-opens-live-naver` + `NAVER_REVIEW_URL`); **NOT reachable from the resident helper** | `LIVE_PROVEN` (2026-07-25 / 07-26, 1 account · 1 segment · disposable backend) | **not wired** — see §3.1 | the import boot opens a browser AT BOOT by product-owner decision (2026-07-25) and needs an operator-owned env var; making it on-demand is a product decision, not a missing line |
| **NAVER — guided review reply (submission)** | `reply-submission` carrier; dev flag drives `SyntheticReplySubmitDriver` | `ONLY_PROBE_OR_FIXTURE` in the product path; the real driver has only `run-reply-submission-live-naver.ts` | `OFFLINE_ONLY` — never run live | **not wired** (marketplace WRITE — the stop rule) | §4.1 already forbids "답변 등록 지원" wording; unchanged |
| **Coupang — issuance guided walk** | #468 put it on the resident helper | `IMPLEMENTED_AND_WIRED` | `LIVE_PROVEN` (2026-08-19 ×2, re-verified in this PR on the same helper as the NAVER walk) | regression-checked only | — |
| **Coupang — `COUPANG_WING_SELECTOR_PROBE` / RECORD** | `probe-wing-issuance-selectors.ts` | `ONLY_PROBE_OR_FIXTURE` **by design** — a read-only calibration recorder CLI with no promotion path; it is not, and was never meant to be, product runtime | `LIVE_PROVEN` as an instrument (2026-08-08 / 08-11 / 08-12 sittings) | none | see §2.1 — what it measured, and what the shipped walk actually uses |
| **Coupang — 기존 키가 있는 사용자 경로** | `KEY_PRESENT` → hand-off branch in the issuance engine | `IMPLEMENTED_AND_WIRED` — engine publishes `credentialState`; `CoupangIssuanceGuidedWalkthrough` reads it (`alreadyHadKey`) and the walk guides ONLY the hand-off, never 발급 | `OFFLINE_ONLY` for the branch itself | none needed | never exercised live on an account that already holds a key |
| **Coupang — 키 있음/없음 자동 detection** | `coupang-credential-state.ts` | `IMPLEMENTED_AND_WIRED` — three-valued (`NO_KEY` / `KEY_PRESENT` / `UNKNOWN`); `NO_KEY` requires a POSITIVE non-empty-cell reading, `UNKNOWN` parks rather than issuing | `OFFLINE_ONLY` | none needed | yes, it was really implemented — but its live proof is the cell calibration, not a two-account A/B |
| **Coupang — credential handoff / order-access probe** | `run-coupang-credential-handoff-live.ts` + `CoupangWingCredentialDriver` | handoff: `IMPLEMENTED_BUT_UNWIRED` in the resident runtime; order-access: **`NEVER_IMPLEMENTED`** (the Coupang API connector is an auth skeleton, §4.1) | handoff `LIVE_PROVEN` under its own gate | **not wired** — the handoff moves a real Access/Secret key (secret write); the stop rule applies | — |
| **Coupang — first ORDER sync** | — | `NEVER_IMPLEMENTED` (인증 골격만, §4.1) | none | none — and it must not be described as working | — |
| **Coupang — locate (`[쿠팡에서 보기]`)** | `run-coupang-review-locate-live.ts` | `IMPLEMENTED_BUT_UNWIRED` in the resident runtime: the FE's `locateSession` sends no `aw_attach`, and the run needs a backend session + a seller already on the 상품평 목록 page | `LIVE_PROVEN` (2026-08-15, `matches=1` ×2, 0 stored) | **not wired** — see §3.2 | the two blockers are design decisions (agent-held backend session; where the window lands), not wiring |
| **Cafe24 — OAuth** | FE `/connect/cafe24` → `api.startCafe24Connect` → `Cafe24Authorizer` / `Cafe24TokenClient` | `IMPLEMENTED_AND_WIRED` (no local agent on this channel at all) | `LIVE_PROVEN` (token rotation included) | none | — |
| **Cafe24 — order sync** | `Cafe24OrdersClient` + aggregator | `IMPLEMENTED_AND_WIRED` | `LIVE_PROVEN` (E2E PASS incl. amount reconciliation) | none | scheduling flag off |
| **Cafe24 — review sync (board 4)** | `Cafe24BoardArticlesClient` → `CanonicalCommunityArticle` | `IMPLEMENTED_AND_WIRED` | `LIVE_PROVEN` (2026-07-30 / 07-31) | none | `reply_status` only ever observed as `UNKNOWN` live |
| **Cafe24 — inquiry sync (board 6)** | `Cafe24InquiryArticleMapper` → 문의 + OPEN 작업항목 | `IMPLEMENTED_AND_WIRED` | `LIVE_PROVEN` (2026-07-31, exact-window contract) | none | board 9 not collected; flag off |

---

## 2. What the audit corrected about our own memory

### 2.1 Coupang has TWO WING label sets, and only one of them is calibrated
`WING_HIGHLIGHT_LABELS` in `coupang-wing-issuance-driver.ts` are still marked
`WING_HIGHLIGHT_CALIBRATION = LIVE_DOM_CALIBRATION_PENDING` — proposed labels, never proven. The guided walk
does **not** point with those. It points with `WING_GUIDED_HIGHLIGHT_PROMOTIONS`, whose every entry cites a
reading taken live (2026-08-11 / 08-12), each promotable reading taken twice on the same screen and agreeing
integer for integer. Reading "calibration pending" as "the walk is uncalibrated" is wrong; reading the
promotions as "every WING label is calibrated" is also wrong.

### 2.2 Three WING fields were never resolved, and the flow does not contain them
`자체개발` and `호출 IP` matched **0**, `업체명` matched **8**, on the real no-key form. The issuance engine
records this directly: 업체명 / 호출 IP "have no screen in this flow". Any memory of the guided walk pointing
at every field of the 발급 화면 is a memory of the plan, not of the shipped walk.

### 2.3 The consent pairing rests on an aggregate, not a per-row census
`WING_CONSENT_PAIRING_LIVE_BASIS = AGGREGATE_CONJUNCTION_TRUE_2026_08_11_PER_ROW_CENSUS_NEVER_RUN`. The
per-row consent-block census has never been run live.

### 2.4 The literal-`**` rendering defect is not in any product-rendered string
Grepped again across `frontend/src`, `collector/src` and `backend/src/main` for `**` inside quoted strings, and
scanned the rendered text of both connect surfaces during today's live proof (NAVER guided, Coupang guided, and
the Coupang text checklist with an IP present: `121.170.254.188`). Zero occurrences. The only `**` in Korean
prose lives in **doc comments** and in the collector's **operator-confirm terminal banner**
(`locateRunGrantBinding().agentDoesNot`), neither of which is product UI.

---

## 3. What was deliberately NOT wired, and why

The instruction was to re-wire everything `IMPLEMENTED_BUT_UNWIRED` by reusing what exists, and to invent
nothing. Three capabilities are unwired in the resident runtime and stay that way, because closing each one
requires a decision rather than a connection.

### 3.1 NAVER review import
Its boot launches a browser AT BOOT and opens SellerOps in it — an explicit product-owner decision
(2026-07-25) so the seller works in one window with one session — and it refuses to start without
`NAVER_REVIEW_URL`. An on-demand version would either drop that single-window premise or need the seller to
supply a marketplace URL. **Product-owner decision required.**

### 3.2 Coupang review locate
Two blockers, neither of them wiring: (a) the run resolves its one-time `locateRef` against the backend with a
session the CLI establishes from operator credentials — a resident helper holding a seller's backend session is
a security decision; (b) the run reads *the 상품평 목록 page the seller already has up*, which the CLI's
operator arranges before pressing. Activating on demand would open a WING window that is not on that page, so
every locate would answer `NOT_ON_PAGE`. **Product-owner decision required.**

### 3.3 NAVER guided review reply
A marketplace WRITE path, never run live. Out of scope by the stop rule.

---

## 4. The three buckets, separated

### 4.1 What was actually a regression / genuinely unwired
- **NAVER guided issuance never had a resident runtime.** Not a regression inside the walk — the walk is
  intact and its selectors are live-calibrated. The gap is that its only host was ever a gated CLI; #466 made
  `--bridge-only` the resident shape and #468 connected Coupang, and NAVER was left behind. The FE had been
  asking for it (`aw_attach{issuance,naver}`) the whole time and getting `NOT_SERVABLE`. **Fixed in this PR.**
- **The NAVER walkthrough's CANCELLED/FAILED dead end** — the identical defect #468 fixed on the Coupang side
  and left in its sibling: the timeline stayed on screen beside an empty control panel. **Fixed in this PR.**
- **`IssuanceGuidanceSession` had no teardown latch** — the same shape that, in the Coupang session, brought a
  released walk's marketplace window back one second after the host closed it. Latent here, fixed before it
  could be observed. **Fixed in this PR.**
- **Both issuance sessions floated the detached `watchBarrier` promise** — a driver retired mid-await would
  reject it unhandled. **Fixed in this PR.**

### 4.2 What we mis-remembered as finished
- Coupang WING highlight labels "calibrated" (§2.1) — two sets, one calibrated.
- The guided walk covering 자체개발 / 업체명 / 호출 IP (§2.2) — those screens are not in the flow.
- Consent pairing proven per row (§2.3) — it is an aggregate boolean.
- Coupang ORDER_SUMMARY sync — auth skeleton only; there has never been a working first sync.
- NAVER review reply — offline only, never live.
- The `**` rendering defect (§2.4) — not reproducible; nothing to fix.

### 4.3 What was used in a way the product did not support
Nothing here is a user error. Two honest asymmetries that read like one:
- **A long-running helper is a version pin.** A `--bridge-only` helper started before a code change keeps
  serving the code it started with, so re-testing after a merge needs a restart. Today's NAVER failure was
  reproducible on merged `main`, so this was not its cause — but it is why the boot line now prints
  `onDemandCarriers`, which is the fastest way to tell which helper you are talking to.
- **`/connect/naver` still offers guided and text as a FORK** at the `application_issuance` phase
  (`NaverIssuanceModeChoice`: "화면을 보며 안내받기" beside "텍스트로 직접 진행하기"), while the walkthrough
  behind it is guided-first and the Coupang screen is guided-first. That is a screen that disagrees with the
  stated product intent — **recorded, not changed**, because it is a journey/UX decision, not a wiring gap.
  In today's live run the journey entered the guided walkthrough directly, so the fork was not on the path.
