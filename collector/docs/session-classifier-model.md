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

## 5b. Still deferred

- **Live confirmation of the placeholder reconnect markers** (`ACCOUNT_RECONNECT_MARKERS`)
  and a real `LOGGED_IN` / `RECONNECT_REQUIRED` contrast sample. Until then a real Commerce
  interstitial may still fall to `UNKNOWN → SESSION_EXPIRED`: the wiring is honest, the
  trigger is still a placeholder. This is the standard "correct placeholders from sanitized
  findings" loop, on explicit operator approval — a diagnostic run, not a code PR.

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
- Fixtures (synthetic, no PII): existing `session_login*.html`, `session_2fa.html`,
  `session_logged_in.html`, `session_branding_only.html`, `session_admin_with_login_widget.html`,
  plus new `session_reconnect.html` (Commerce account-selection interstitial — PLACEHOLDER
  markers) and `session_seller_center_with_login_link.html` (relaxed-LOGGED_IN: ambient login
  link, no password).
