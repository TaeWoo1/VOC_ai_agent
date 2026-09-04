# Local Helper Pilot Packaging v1 (2026-09-05)

The reviewnary 도우미 as a product a seller installs, connects, and keeps using — instead of a developer's
`tsx` checkout. Guided Acquisition / Guided Reply browser automation is **unchanged**; what this package
adds is the shell around it: a packaged helper, one state model, one install page, a diagnostics split, and
the recovery states reproduced on the real installed helper.

Marketplace calls **0** · marketplace WRITE **0** · approvals **0** · migrations **0** · model calls **0**.
The end-to-end live leg (§8) was **prepared and not run** — it needs a person at the Mac (허용, NAVER login,
the export click) and a fresh single-use approval, and neither can be supplied from here.

---

## 1. What existed (audit)

| | finding |
|---|---|
| start paths | `tsx src/cli/local-agent.ts --bridge-only` via `agent-supervisor.sh` (needs a terminal: first pairing shows a code on stderr, first run asks the SellerOps login on the TTY), or `local-agent-service install` (launchd user agent, darwin only, native 허용/거부 dialog, `NODE_ENV=production`) |
| packaged artifact | **none** — a recorded, tested finding (`helperFreeFirst.test.tsx`); every path assumes the git checkout, `npm install`ed `collector/`, Node, and a Playwright Chromium download |
| the two paths were disjoint | launchd **refuses a password in the plist** (`SECRET_ENV_KEY`, correctly — a plist is world-readable) and the helper needs a SellerOps login for every backend call; the supervisor carries the login but pairs only in a foreground TTY. Neither was a complete seller path. |
| helper state | lived under the checkout (`collector/.profile`, `.bridge`, `.status`, `downloads`) with a guard that **refused** any other location — a packaged helper that is replaced on update would have lost every NAVER login |
| version | `agentVersion` was the literal `"0.0.1-poc"`; on `incompatible_version` the UI said 「업데이트가 필요해요」 with **no control** |
| /connect | zero helper state (the dock is behind a developer flag); two sections describing the same job; a link called 「작업대」; `lastError` shown verbatim (`GW.IP_NOT_ALLOWED`, `HTTP 403`) or not at all |
| NAVER login | the helper already records its observation (`sessionReadiness` + `sessionObservedAt` on the account's slot, `contracts/session-readiness/v1`); no screen showed it |

## 2. Pilot support boundary

**macOS 13+, one architecture per bundle (arm64 built here; an Intel bundle is the same script on an
Intel Mac). Windows is not supported in this pilot** — the launchd adapter and the native approval dialog
are the only human-approval channel the helper has, and a fake Windows path would be exactly the kind of
cross-platform claim the brief forbids. Distribution is **operator-assisted**: the bundle is unsigned and
un-notarized (no signing identity in this repository), so a downloaded copy is quarantined and the seller
opens it once via right-click → 열기; the pilot runbook has the operator on a screen-share for that step.

## 3. The bundle

`tools/helper/build-macos.sh` → `dist/reviewnary-helper-macos-<arch>/` (630 MB, 553 MB of it Chromium):

- `app/helper.mjs` — the resident helper, one ESM bundle (esbuild, Playwright external, `require` shim for `ws`)
- `app/service.mjs` — launchd install · status · uninstall
- `app/first-run.mjs` — the seller's reviewnary login, asked in a **native dialog** (hidden answer), verified
  with `POST /api/auth/login`, written to `helper.env` **0600** under the seller's own home
- `app/bin/node`, `app/node_modules/playwright*`, `browsers/` (the Chromium the helper drives)
- `reviewnary 도우미 설치.command` · `제거.command` · `읽어주세요.txt`

**The two paths are one now.** The launchd plist carries paths only (`REVIEWNARY_HELPER_HOME`,
`PLAYWRIGHT_BROWSERS_PATH`, `BRIDGE_ALLOWED_ORIGINS`); the helper itself loads `<home>/helper.env`
(closed key list, process env wins). The plist still refuses secrets — the test that pinned that is
untouched. State lives under `~/Library/Application Support/reviewnary-helper/` and survives an update
(the installer replaces `app/` and `browsers/` only); the profile guard follows the home. Unset, every path
is where it always was, so the developer checkout is byte-identical in behaviour.

Two defects the first build exposed and closed: every CLI module's `if (invoked directly) main()` guard
is **true for all of them inside one bundle** (the first `service.mjs` printed a NAVER tutorial banner and
exited) — `invokedDirectly(import.meta.url, "<own file>")` now names its own source, and the bundle's
entries call the function they want; and `ws` is CommonJS.

Installed on this Mac: `install` → `healthy:true, agentVersion 0.1.0, protocolVersion 1, approvalPresenter macos_native`,
`launchctl print` → running.

## 4. The seller's state model

`frontend/src/lib/helper/helperStatus.ts` turns three axes (bridge phase · health version · the helper's
last session observation) into six words with one control each, and no internal word leaves the file
(pinned: bridge · carrier · pairing · token · port · profile · localhost are absent from every label and note).

| word | when | control |
|---|---|---|
| 연결됨 | paired | — |
| 설치 필요 | nothing answered on this machine and this browser never held a pairing | 설치 안내 → `/connect/helper` |
| 실행 필요 | nothing answered, but this browser was paired before | 다시 찾기 · 시작 방법 보기 |
| 다시 연결 필요 | the helper answered and this browser is not connected (unpaired · denied · revoked · no response) | 도우미 연결 (raises the native dialog **only on press**) |
| 연결 확인 중 | the dialog is open on the Mac | — (「허용을 눌러 주세요」) |
| 업데이트 필요 | wire refused (`incompatible_version`) **or** `agentVersion` < `MIN_HELPER_VERSION` | 업데이트 방법 보기 |

NAVER line: 로그인됨 (READY, with 「N 전 확인」) · 로그인 필요 (LOGIN_REQUIRED / EXPIRED) · 추가 인증 필요 ·
계정 선택 필요 · 확인되지 않음 (never 로그인됨 without an observation). 「네이버 로그인」 opens the guided
run whose first step is the seller's own login in the helper's persistent window — the same profile the live
proofs used; a login survives helper restarts because the profile dir is deterministic on (channel, slot).

## 5. Recovery — reproduced on the installed helper

| state forced | seller sees | evidence |
|---|---|---|
| helper running, browser never paired | 다시 연결 필요 · [도우미 연결] | 1440/1366/1152, AA 0 |
| [도우미 연결] pressed | 연결 확인 중 · 「내 PC 화면에 뜬 reviewnary 창에서 허용을 눌러 주세요」 | dialog raised on this Mac |
| backend restarted | helper health unchanged, launchd still running, card unchanged | helper is not the backend's child |
| `launchctl bootout` (helper stopped) | 설치 필요 (never paired) / 실행 필요 + 다시 찾기 (paired before) | |
| old helper on the port (`REVIEWNARY_HELPER_VERSION_OVERRIDE=0.0.9`, dev only) | 업데이트 필요 · [업데이트 방법 보기] → `/connect/helper` | |
| re-bootstrap (what a Mac re-login does) | back to 다시 연결 필요 with version 0.1.0 | |
| NAVER 로그인 필요 | **not forced live** — it is written only by the helper's own observation during a walk; the mapping is unit-tested and the live reproduction is part of §8 | |
| 연결은 살아 있지만 작업 실패 | the failing channel row: seller sentence + 「기술 정보」 fold with the raw string | §7 |

**One thing this session cannot claim.** The pairing I raised came back 「연결됨」 rather than 「응답 없음」.
The presenter reports approval only when the dialog's 허용 button prints its token — so a person at this
Mac answered it; I did not and could not. The resulting pairing belongs to a headless QA browser whose
storage is gone; it is an orphan row in the helper's pairing store. The helper's log of that instance was
replaced when launchd re-bootstrapped it, so the line itself is not in evidence.

## 6. Version / update

`agentVersion` is the package version (`0.1.0`, read beside the bundle, then the package root). The frontend
holds `MIN_HELPER_VERSION` and treats an older helper the same as a wire refusal — a word and a page, never a
dead end. No auto-update platform: update = run the new folder's 설치.command; login, pairing and NAVER
session are kept (the installer never touches `helper.env`, `.bridge`, `.profile`). A protocol bump remains
exact-equality on `BRIDGE_PROTOCOL_VERSION` (unchanged, 1).

## 7. Diagnostics split

`ConnectorErrorWording.sellerSentence(lastError)` — closed mapping, backend-owned: `GW.IP_NOT_ALLOWED` names
the caller IP and **never asks for a credential**; auth codes → 다시 연결; 403 → 권한; 429 → 한도; timeouts /
connection refused → 다음 수집에서 다시 시도; anything else → the one sentence that is always true.
`ConnectionStatusView.lastErrorKo` is rendered in the row's fold; `lastError` stays verbatim under
「기술 정보」 for whoever is helping. Pinned: no `GW.` / `HTTP` / `Exception` reaches a sentence.

## 8. End-to-end live leg — prepared, not run

Sequence: 로그인 → 채널 연결 → [도우미 연결] → 허용 (Mac) → 네이버 로그인 (helper's window) → Guided
Acquisition READ (seller clicks export in the NAVER window; helper observes) → exact review → Guided Reply
composer fill → **STOP before the seller's own submit**. Marketplace WRITE 0 by construction
(`COMPOSER_FILLED ≠ posted`; the submit is the seller's click and this run never reaches it).

Blocked from here for two reasons that are not defects: every step past [도우미 연결] is a human action on
this Mac (허용, NAVER login, the export click), and a live marketplace READ needs a fresh single-use approval
(`docs/sellerops_live_approval_contract.md`). The manifest below is ready; the grant is the operator's
「Seated and ready.」 in the turn that starts it.

```
Approval Manifest — draft (no approvalId minted; minted by bootstrap when the operator is seated)
channel:    NAVER (스마트스토어)          account: the Demo Org's connected NAVER account
surface:    판매자센터 리뷰 화면 (helper's persistent profile)
operation:  Guided Acquisition READ (export observed) → exact review → Guided Reply composer fill
mode:       READ + composer fill; WRITE 0; the seller's submit is NOT part of this run
allowed:    helper opens/raises the window, highlights, observes; seller logs in, clicks export, reads
runtime:    packaged helper 0.1.0 (launchd), backend/frontend at this commit
```

## 9. Connect — before / after

Before: 채널 · 정기 자료 가져오기 · 리뷰 수집 실행 (+ 리뷰 수집 card), a 「작업대」 link, no helper state,
gateway codes in the fold. After: 채널 → **reviewnary 도우미** (state word + one control; NAVER line) →
**자료 가져오기** (one section, two actions, 「실행 기록」). 1440/1366/1152: AA text violations **0**,
horizontal scroll 0, internal words 0. Screens in the report.

## 10. KST boundary (Agentic Report debt)

Measured: 112 REAL reviews and 1,245 inquiries of the Demo Org fall on a different day in UTC than in KST.
The report's counters were already KST (Overview series); its **issue window** bucketed by `occurred_on`,
which is the review's UTC date by the extraction contract. Smallest correction: the window query joins the
review and buckets its receipt in Asia/Seoul; `occurred_on` and every other window keep their contract.
Pinned by a Postgres-backed test (00:30 KST on the 31st counts on the 31st).

## 11. Verification

collector · backend · frontend suites in the commit message; typecheck clean (one pre-existing test-file
type error in `reply-session.test.ts`, untouched). Contract rewrites: `ConnectHub.test` (sections and the
「작업대」 link, now 「실행 기록」), `RuleBased…` none; safety tests weakened **0** (the plist secret refusal,
the entrypoint tree guard, and the production-only presenter are all still asserted).

## 12. Remaining pilot blockers

- **Signing/notarization**: none — first open is right-click → 열기, operator-assisted.
- **Two arches, two bundles**: built on arm64; the Intel bundle needs an Intel build machine.
- The helper's backend login is the seller's reviewnary password in a 0600 file on their Mac (the same
  posture the supervisor had). A device token would be better and is a backend change.
- 「네이버 로그인」 goes through the guided-import screen; there is no login-only walk.
- `BRIDGE_ALLOWED_ORIGINS` is the app origin the installer was told; a pilot host must set `REVIEWNARY_APP_URL`
  / `REVIEWNARY_BASE_URL` when running the installer (defaults are the local stack).
- The E2E live leg and the LOGIN_REQUIRED reproduction wait for a seated operator (§8).
