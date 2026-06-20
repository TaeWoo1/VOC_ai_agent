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
   **not** suppress this — only a real password field does (caught by rule 2) — because
   NAVER/Commerce seller-center pages can embed ambient login widgets while the session is
   usable. `LOGGED_IN` is checked **before** `RECONNECT_REQUIRED`.
4. `accountReconnectAffordancePresent` (and not already `LOGGED_IN`) →
   **RECONNECT_REQUIRED** — account chooser / Commerce reconnect / store selection; a human
   click/login is needed.
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
  reconnect / store-selection affordance. **PLACEHOLDER markers** (`ACCOUNT_RECONNECT_MARKERS`
  in `session-probe.ts`) — specific phrases (다른 계정 / 계정 선택 / 이 계정으로 계속 / 스토어
  선택 / 커머스 ID 로그인 / account-chooser / reconnect), deliberately not bare
  계정/account/스토어/커머스. To be confirmed/corrected from a later sanitized live probe.
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
  source. Both live CLIs (`discover-export.ts`, `discover-same-session.ts` via
  `classifyOnlyStatus`) gate on the verdict; discovery never auto-clicks account/store
  selection — every non-`LOGGED_IN` verdict halts for a human.
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

It is **read-only and structurally separate** from the classify-only discovery flow: it
never imports `review-export`/`runExport`, never clicks/captures an export, waits on no
download, writes no `.status` file, and sends nothing to SellerOps — locked by a
source-guard test (`test/cli/probe-same-session.test.ts`). Use it (not
`discover-same-session`, whose classify-only path *can* click a sync-export control on a
`LOGGED_IN` page) when the boundary is "no export click, no download".

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

Discovery's `classifyOnly` path proves the mechanism by *triggering* it — it still clicks the
export control and waits for the download stream (it only skips persisting the file, §129–130
above). For a strict **no-click** boundary we instead decide the layout from the **rendered
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
browser/click/download/save path. **This adds the safe path only — it does not change the existing
discovery/capture behavior;** converting `discover-same-session`'s `classifyOnly` to this no-click
planner (or gating its click behind a separate flag) is a deliberate follow-up slice.

## 5c. Still deferred

- **Live confirmation of the placeholder reconnect markers** (`ACCOUNT_RECONNECT_MARKERS`)
  and a real `LOGGED_IN` / `RECONNECT_REQUIRED` contrast sample — now capturable via
  `probe-same-session` above. Until confirmed, a real Commerce interstitial may still fall
  to `UNKNOWN → SESSION_EXPIRED`: the wiring is honest, the trigger is still a placeholder.
  This is the standard "correct placeholders from sanitized findings" loop, on explicit
  operator approval — a diagnostic run, not a code PR.

## 6. Tests & fixtures

- `test/naver/session-verdict.test.ts` — pure precedence/relaxed-rule unit tests.
- `test/naver/session-probe.test.ts` — verdict wiring across fixtures, the
  `candidateLoggedInShellPresent` structural-only **regression**, the no-leak sweep, and the
  allow-list (`SANITIZED_PROBE_KEYS`) for the two new fields.
- `test/naver/session-halt.test.ts` — `haltForVerdict` for all five verdicts (proceed flag,
  `CollectorState`, honest content-free detail; reconnect ≠ `SESSION_EXPIRED`; never
  `LAST_SUCCESS`).
- `test/naver/session-check.test.ts` — `sessionVerdictFromContent` across fixtures and
  `checkLiveSessionVerdict` log-safety (verdict + coarse category only, no raw URL).
- `test/cli/same-session.test.ts` — `classifyOnlyStatus` verdict-keyed halt states.
- `test/naver/export-classify.test.ts` — `planExportAction` layout/bucket/async-precedence
  units, allow-list (`EXPORT_ACTION_PLAN_KEYS`), hostile-fixture no-leak (incl. no raw selector),
  and the purity source-guard on `export-classify.ts`.
- `test/cli/classify-export-same-session.test.ts` — the no-click CLI source-guard (no
  `.click(`/download-wait/`saveAs`/upload/`writeStatus`; imports only the pure planner; sentinel
  continuation).
- Fixtures (synthetic, no PII): existing `session_login*.html`, `session_2fa.html`,
  `session_logged_in.html`, `session_branding_only.html`, `session_admin_with_login_widget.html`,
  plus new `session_reconnect.html` (Commerce account-selection interstitial — PLACEHOLDER
  markers) and `session_seller_center_with_login_link.html` (relaxed-LOGGED_IN: ambient login
  link, no password).
