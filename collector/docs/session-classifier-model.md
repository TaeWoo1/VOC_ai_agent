# SellerOps session-verdict classifier — specification

> Offline; pure; sanitized. Coarse signals → a five-state `SessionVerdict`. No `Date.*`,
> no wall-clock, no live collection, no real NAVER DOM/PII in source. Implemented in
> `src/naver/session-verdict.ts`; wired into the sanitized probe in
> `src/naver/session-probe.ts`; and — since the discovery-rewiring slice — the **primary
> classifier for the discovery halt path** via `src/naver/session-halt.ts` +
> `src/naver/session-check.ts`.

## 1. Why this exists

The probe used to emit raw signals with **no verdict**, and the discovery/status path
collapsed every non-`LOGGED_IN` outcome to `LOGGED_OUT` → `SESSION_EXPIRED`
(`src/status.ts:49`). That conflated four very different situations a human must respond to
differently:

- a **usable seller-center session**,
- a **full NAVER account login** (password form),
- a **Commerce / account-selection reconnect interstitial** (NAVER account is authenticated,
  but Commerce needs an account/store pick — a click, not a re-login, and **not** a broken
  profile), and
- an **auth challenge** (CAPTCHA / 2FA).

A live probe reproducibly showed the old `candidateLoggedInShellPresent` reading `true` on
the NAVER **login** page, because its markers included branding text (판매자센터 / 스마트스토어
센터 / 커머스) that appears even when logged out. So branding was demoted and a real verdict
was added.

## 2. Verdict states

`SessionVerdict = LOGGED_IN | RECONNECT_REQUIRED | ACCOUNT_LOGIN_REQUIRED |
AUTH_CHALLENGE_REQUIRED | UNKNOWN`.

## 3. Classification rules (precedence)

Over coarse, already-sanitized boolean inputs (`SessionVerdictInput`):

1. `authChallengePresent` → **AUTH_CHALLENGE_REQUIRED** — a challenge can overlay anything,
   so it wins first.
2. `passwordFieldPresent` → **ACCOUNT_LOGIN_REQUIRED** — a real NAVER account-login form.
3. `isSellerCenterUrl` **and** at least one STRONG seller-center signal
   (`menuOrGnbPresent` | `logoutAffordancePresent` | `exportCandidatesPresent`) →
   **LOGGED_IN**. **Relaxed:** an ambient login / account / reconnect *affordance* does
   **not** suppress this. `LOGGED_IN` is checked **before** `RECONNECT_REQUIRED`.
   Rule 2 (password) is **guarded by the reconnect affordance** (Run-1 finding): a password
   field forces `ACCOUNT_LOGIN_REQUIRED` **only when there is no reconnect/account-continuation
   affordance**. The real Commerce reconnect screen shows a currently-logged-in
   account-continuation card above an *alternate* login form; that form sets
   `passwordFieldPresent`, but the human can continue without re-login, so a bare password rule
   wrongly masked the reconnect. When both are present the verdict falls through — a strong
   seller-center session still wins (rule 3), otherwise reconnect does (rule 4).
4. `accountReconnectAffordancePresent` (and not already `LOGGED_IN`) →
   **RECONNECT_REQUIRED** — account chooser / Commerce reconnect / store selection /
   account-continuation card; a human click/login is needed.
5. otherwise → **UNKNOWN** (ambiguous; never proceed to export).

### Demoted / non-inputs

- **`candidateLoggedInShellPresent` is DEBUG-ONLY and is NOT a classifier input.** It now
  matches **structural shell attributes only** (`data-seller-authenticated`,
  `id="seller-gnb"`) — branding text is gone, so it reads `false` on the login page. It can
  never, alone, imply `LOGGED_IN`.
- **`loginAffordancePresent` is NOT a classifier input** either — a login *link* must not
  suppress a strong seller-center session (the relaxation above).

## 4. Probe output changes (`SanitizedProbeSignals`)

- **Added** `sessionVerdict: SessionVerdict` (coarse enum).
- **Added** `accountReconnectAffordancePresent: boolean` — account-chooser / Commerce
  reconnect / store-selection / account-continuation affordance (`ACCOUNT_RECONNECT_MARKERS`
  in `session-probe.ts`) — specific phrases (다른 계정 / 계정 선택 / 이 계정으로 계속 /
  **현재 로그인 중인** / 스토어 선택 / 커머스 ID 로그인 / account-chooser / reconnect), deliberately
  not bare 계정/account/스토어/커머스. **Corrected from the Run-1 sanitized finding:** the live
  Commerce reconnect screen presents a *currently-logged-in account-continuation card*
  (`현재 로그인 중인 …`) above an alternate login form. That card wording is the discriminator;
  generic login-button text (간편 로그인 / 네이버 아이디로 간편 로그인 / bare 네이버 커머스 ID) is
  **deliberately excluded** — it appears on plain login pages too and would flip a real login
  page to `RECONNECT_REQUIRED` under the reconnect-guarded password rule.
- **Tightened** `candidateLoggedInShellPresent` to structural-only (see §3).

All fields remain booleans / bucketed counts / category enums — the no-leak contract holds
(`sessionVerdict` and the new boolean cannot carry text/PII).

## 5. Discovery / status wiring (implemented)

The verdict is now the authority for the discovery HALT decision. Pure mapping
`haltForVerdict(verdict)` (`src/naver/session-halt.ts`) → `{ proceed, state, detail }`:

| `SessionVerdict`          | proceed? | `CollectorState`                       | detail (operator-facing) |
|---------------------------|----------|----------------------------------------|--------------------------|
| `LOGGED_IN`               | **yes**  | — (continue to export classification)  | n/a |
| `RECONNECT_REQUIRED`      | no       | `RECONNECT_REQUIRED` *(new)*           | "Commerce reconnect required — complete account/store selection via interactive `--login`, then re-probe." |
| `ACCOUNT_LOGIN_REQUIRED`  | no       | `ACCOUNT_LOGIN_REQUIRED` *(new)*       | "NAVER account login required." |
| `AUTH_CHALLENGE_REQUIRED` | no       | `ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA`   | "Auth challenge (2FA/CAPTCHA) — clear it, then re-probe." |
| `UNKNOWN`                 | no       | `SESSION_EXPIRED` *(conservative)*     | "Session not confirmed usable — reconnect required." |

- **New `CollectorState` members** `RECONNECT_REQUIRED` and `ACCOUNT_LOGIN_REQUIRED`
  (`src/status.ts`); `SESSION_EXPIRED` is now reserved for the genuinely-ambiguous/expired
  case, so a known-account Commerce reconnect no longer reads as "session expired / profile
  broken". The additions are purely additive (no exhaustive switch over `CollectorState`).
- **Verdict seam** `sessionVerdictFromContent(html, url)` + live wrapper
  `checkLiveSessionVerdict(page)` (`src/naver/session-check.ts`) reuse the probe's tightened,
  branding-demoted markers — so discovery and the diagnostic probe share **one** signal
  source. Both live CLIs gate on the verdict (`haltForVerdict` / `classifyOnlyStatus`), and both
  classify-only paths (`discover-export.ts` and `discover-same-session.ts`) map the no-click layout
  to status via `classifyOnlyStatusFromPlan`; discovery never auto-clicks account/store selection
  — every non-`LOGGED_IN` verdict halts for a human.
- **Back-compat preserved:** `src/session.ts` `detectSession()` / `signalsFromHtml()` and
  `src/status.ts` `decideState()` are **unchanged** (still `LOGGED_OUT → SESSION_EXPIRED`);
  they remain for the export/upload legs and existing tests but are no longer the halt
  authority. Two marker sets thus coexist (`session.ts` vs `session-probe.ts`) — intentional
  for now; a future cleanup can retire `detectSession` once the verdict is proven live.

## 5b. Confirming the verdict live (read-only) — `probe-same-session`

Bridging an interactive `--login` to a later separate-launch `probe-session` loses the
NAVER/Commerce session on the browser restart, so the probe always re-reads a login page
(diagnosed: same `profileDir`/channel, not a path bug — the *restart* is the failing
variable). To read the verdict in the session the human actually established, use
`src/cli/probe-same-session.ts` (`npm run probe-same-session -- --i-understand-this-opens-live-naver`):
one persistent-context lifetime — open NAVER → the human logs in / clears 2FA-CAPTCHA /
picks the Commerce account+store and navigates to the target → **signals readiness by
creating the sentinel file the probe prints** → the **same** context reads the page **as
left** and prints the sanitized `extractProbeSignals` output (including `sessionVerdict`).

**Continuation = a sentinel file, not a terminal Enter.** The Bash tool's stdin does not
reliably deliver an Enter keypress, so the probe polls for a sentinel file whose exact
absolute path it prints — default `.status/probe-same-session.ready`, derived by the pure
`src/cli/probe-sentinel.ts` (`sentinelPathFor`). When ready, the operator (or Claude on
their behalf) creates that file with constant non-secret content
(`printf 'ready\n' > .status/probe-same-session.ready`). The probe clears any stale
sentinel at startup (so a leftover can never auto-proceed), proceeds only when it appears
afterwards, removes it after use, and on timeout aborts **without reading** the page. It
only ever reads/clears the sentinel — it never writes a status record.

It is **read-only and structurally separate** from the discovery flow: it never imports
`review-export`/`runExport`, never clicks/captures an export, waits on no download, writes
no `.status` file, and sends nothing to SellerOps — locked by a source-guard test
(`test/cli/probe-same-session.test.ts`). Use it when you want only the session verdict and
nothing written to `.status` — `discover-same-session` is now also no-click (§5b″) but reads
the export structure and persists a status record.

## 5b′. Locating the export UI live (read-only, frame-aware) — `probe-export-same-session`

`probe-same-session` reads only the **top document**, so on the review route a `LOGGED_IN`
page still reports `exportCandidateCount: "none"` — and that one reading **cannot tell apart**
a nested iframe, a shadow DOM, a sub-route, a gated/hidden control, or a marker mismatch (all
read identically as "none"). `src/cli/probe-export-same-session.ts`
(`npm run probe-export-same-session -- --i-understand-this-opens-live-naver`) keeps the **same**
one-context + sentinel flow but reads the **top document plus every child frame** so the next
live run can *observe* which frame (if any) hosts export controls instead of guessing.

It reuses the existing pure sanitizer `extractExportProbeSignals` (`src/naver/export-probe.ts`)
**once per frame** — `page.frames()` returns all frames flattened (nested included) — then folds
the per-frame results with the pure `summarizeFrameExportProbes`. Output is sanitized only:
`sessionVerdict` (gate), a bucketed `frameCount`, `anyFrameExportCandidates` (a frame with a
**visible AND enabled** candidate), the top document's signals, and one record per child frame
(`frameUrlCategory` — a category enum, never a raw URL — `readResult`, and that frame's sanitized
signals). Per-frame reads degrade on detached/cross-origin/`about:blank` frames (`"blocked"`/
`"empty"`, `signals: null`) without aborting; only **open** shadow roots are observable (a
browser limit, not claimed exhaustive).

Same **read-only, structurally-separate** boundary as `probe-same-session`, locked by its own
source-guard (`test/cli/probe-export-same-session.test.ts`): never imports `review-export`/
`runExport`, never clicks/captures an export (the per-frame scan only reads text/attributes/
geometry — no click/fill/press/dispatch), waits on no download, writes no `.status` file, and
sends nothing to SellerOps. It shares the **same** sentinel path, so run only **one** probe at a
time. It does not assert "iframe confirmed" — it reports observed structure; a confirmed cause
requires a frame actually showing candidates.

## 5b″. Classifying the export layout live without clicking — `classify-export-same-session`

The original `runExport({ classifyOnly })` path proved the mechanism by *triggering* it — it
clicked the export control and waited for the download stream (it only skipped persisting the
file). For a strict **no-click** boundary we instead decide the layout from the **rendered
structure alone**. `src/naver/export-classify.ts` adds a pure `planExportAction(html)` that folds
`review-export.ts`'s existing pure pieces (`classifyExportPage` / `findExportCandidates` /
`buildTriggerSelectors`) into one sanitized `ExportActionPlan`:

- `layout` — `SYNC_DOWNLOAD` / `ASYNC_JOB_DETECTED` / `LAYOUT_UNRECOGNIZED`;
- `hasActionableExportCandidate` + `actionableExportCandidateCount` — a visible+enabled
  interactive export control is present (bucketed count);
- `triggerSelectorCount` — how many trigger selectors `runExport` *would* try, **count only**
  (the raw selector strings, which can embed ids/keywords, are never emitted);
- `asyncMarkerPresent` — an async download-center/job affordance is present (it wins over sync).

`src/cli/classify-export-same-session.ts`
(`npm run classify-export-same-session -- --i-understand-this-opens-live-naver`) keeps the **same**
one-context + sentinel flow as the probes, reads the page **as the human left it** (no re-nav),
and prints `{ sessionVerdict, plan, exportSignals }` — the verdict gate, the no-click plan, and the
reused sanitized `extractExportProbeSignals` context. It imports **only** the pure planner (never
`review-export`/`runExport`); its source-guard (`test/cli/classify-export-same-session.test.ts`)
forbids `.click(` / `.fill(` / `.press(` / `dispatchEvent` / `waitForEvent("download")` / `saveAs` /
upload / `writeStatus`, and a purity guard on `export-classify.ts` proves that module reaches no
browser/click/download/save path.

### `discover-same-session` now classifies no-click (default discovery path)

`discover-same-session.ts`'s classify-only step is now wired onto `planExportAction` too: after
the `LOGGED_IN` verdict it reads the page the human left (`page.content()`) and decides the
layout from structure — it **no longer imports `runExport`** and never clicks the control or
waits for a download (own source-guard: `test/cli/discover-same-session.test.ts`). The layout maps
to a status record via the pure `classifyOnlyStatusFromPlan(verdict, plan)`:

- `SYNC_DOWNLOAD` → export outcome `SYNC_DOWNLOAD_DETECTED` → state **`EXPORT_SYNC_DETECTED`** —
  the sync mechanism is recognized but **not triggered**, so no file exists. `decideState` returns
  this before the upload leg, so it can never become `COLLECTING`/`LAST_SUCCESS` (it replaces the
  old `CAPTURED → COLLECTING` that the clicking path produced).
- `ASYNC_JOB_DETECTED` → `EXPORT_ASYNC_JOB_DETECTED`; `LAYOUT_UNRECOGNIZED` → `EXPORT_LAYOUT_CHANGED`
  (unchanged from the prior outcome mapping).

`discover-export.ts`'s `--classify-only` branch is now no-click too: `doDiscover` splits into
`doDiscoverClassifyOnly` (reads `page.content()` → `planExportAction` → `classifyOnlyStatusFromPlan`,
**no `runExport`**) and `doDiscoverFullCapture` (keeps `runExport` for the real capture+upload leg).
Because the file legitimately still imports `runExport`, a global "no `runExport`" guard is
impossible — instead a **branch-separation** source-guard
(`test/cli/discover-export.test.ts`) slices the file into its top-level `async function` bodies and
proves `runExport`/`.click(`/`waitForEvent("download")`/`saveAs`/upload appear **only** in
`doDiscoverFullCapture`, never in the classify-only function. The **only** path that still
triggers/captures the export is that deliberate full capture leg (`discover-export --discover`
without `--classify-only`).

## 5c. Reconnect markers — corrected from Run 1

- **Run 1 (`probe-same-session`)** read the live Commerce reconnect screen as
  `accountReconnectAffordancePresent: false` / `sessionVerdict: ACCOUNT_LOGIN_REQUIRED`. The
  sanitized finding showed two defects, both now fixed offline: (a) the screen's
  account-continuation card wording (`현재 로그인 중인 …`) was not a marker — **added**; and
  (b) the alternate login form's `passwordFieldPresent` masked the reconnect — the password
  rule is now **guarded by the reconnect affordance** (`session-verdict.ts`). Covered by the
  synthetic `fixtures/session_reconnect_with_login_form.html` (continuation card + alternate
  login form → `RECONNECT_REQUIRED`) plus an over-match guard (a generic 간편 로그인 phrase
  alone stays `ACCOUNT_LOGIN_REQUIRED`).

## 5d. Still deferred

- **`ASYNC_JOB_MARKERS`** (`review-export.ts`) remain placeholders pending a live async run —
  the in-flight status wording (`처리 중` / `대기열`) only appears with a real job, so confirming
  it needs a separately-approved diagnostic, not a code PR.
- An optional `LOGGED_IN` ↔ `RECONNECT_REQUIRED` live contrast sample (human completes the
  account-continuation step) would further corroborate the corrected markers — on explicit
  operator approval, a diagnostic run.

## 6. Tests & fixtures

- `test/naver/session-verdict.test.ts` — pure precedence/relaxed-rule unit tests, incl. the
  **reconnect-guarded password rule** (password + reconnect → `RECONNECT_REQUIRED`; password
  alone → `ACCOUNT_LOGIN_REQUIRED`; auth still first; a strong seller-center session still wins).
- `test/naver/session-probe.test.ts` — verdict wiring across fixtures, the
  `candidateLoggedInShellPresent` structural-only **regression**, the no-leak sweep, the
  allow-list (`SANITIZED_PROBE_KEYS`), the Run-1 `session_reconnect_with_login_form.html`
  (continuation card + alternate login form → `RECONNECT_REQUIRED`), and the over-match guard
  (a generic 간편 로그인 phrase alone stays `ACCOUNT_LOGIN_REQUIRED`).
- `test/naver/session-halt.test.ts` — `haltForVerdict` for all five verdicts (proceed flag,
  `CollectorState`, honest content-free detail; reconnect ≠ `SESSION_EXPIRED`; never
  `LAST_SUCCESS`).
- `test/naver/session-check.test.ts` — `sessionVerdictFromContent` across fixtures and
  `checkLiveSessionVerdict` log-safety (verdict + coarse category only, no raw URL).
- `test/cli/same-session.test.ts` — `classifyOnlyStatus` verdict-keyed halt states, plus
  `classifyOnlyStatusFromPlan` (no-click layout → status: `SYNC_DOWNLOAD → EXPORT_SYNC_DETECTED`,
  never `COLLECTING`/`LAST_SUCCESS`; identical verdict halting).
- `test/cli/discover-same-session.test.ts` — source-guard that the default discovery path is
  strictly no-click (no `runExport`/`review-export`/`.click(`/`waitForEvent("download")`/`saveAs`/
  `download.path`/upload; imports the pure `planExportAction` + `classifyOnlyStatusFromPlan`).
- `test/cli/discover-export.test.ts` — branch-separation source-guard: slices the file into its
  `async function` bodies and proves `doDiscoverClassifyOnly` is no-click (no `runExport`/`.click(`/
  `waitForEvent("download")`/`saveAs`/upload) while `runExport` stays confined to
  `doDiscoverFullCapture`.
- `test/status.test.ts` — `SYNC_DOWNLOAD_DETECTED → EXPORT_SYNC_DETECTED`, and that it can never
  reach `COLLECTING`/`LAST_SUCCESS` even with an `OK` upload field (no captured file).
- `test/naver/export-classify.test.ts` — `planExportAction` layout/bucket/async-precedence
  units, allow-list (`EXPORT_ACTION_PLAN_KEYS`), hostile-fixture no-leak (incl. no raw selector),
  and the purity source-guard on `export-classify.ts`.
- `test/cli/classify-export-same-session.test.ts` — the no-click CLI source-guard (no
  `.click(`/download-wait/`saveAs`/upload/`writeStatus`; imports only the pure planner; sentinel
  continuation).
- Fixtures (synthetic, no PII): existing `session_login*.html`, `session_2fa.html`,
  `session_logged_in.html`, `session_branding_only.html`, `session_admin_with_login_widget.html`,
  `session_reconnect.html` (Commerce account-selection interstitial — clean chooser, no
  password), `session_reconnect_with_login_form.html` (Run-1: account-continuation card +
  alternate login form), and `session_seller_center_with_login_link.html` (relaxed-LOGGED_IN:
  ambient login link, no password).
