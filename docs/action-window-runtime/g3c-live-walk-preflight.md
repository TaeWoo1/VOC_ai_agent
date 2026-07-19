# G3-C Assisted Live Walk — Preflight (NAVER Guided Connection)

> **Status:** PREFLIGHT / PLAN-ONLY (2026-07-19). **No browser launched.** This document authorizes
> nothing — a live run needs a **fresh, single-use, in-turn G3 (env + pause-lift, scoped read-only) +
> G6 (per-run approval)** named by the product owner in the dispatching turn (`r4-preparation.md` §3;
> both consumed with the run). Prepared per the NAVER v1 phase; sibling of
> `naver-smartstore-v1-plan.md` and the ratified `docs/slices/naver-guided-connection.md` (§0, G3-C).

## 0. Honest tooling situation (grounding)

- **`probe-session.ts` exists** and is the right read-only instrument for **session/login readiness**:
  live, **debug-safe, no-click**, refuses without `--i-understand-this-opens-live-naver`, emits **only**
  sanitized signals (url→category enum, hydration result, readyState, bucketed scalars, structural
  booleans), **never** saves HTML/text/screenshots, **never** uploads, **never** starts the backend,
  **never** mutates the DB, and **always** closes the context in `finally`.
- **Nothing in `collector/src` observes the NAVER *API center*** (`apicenter.commerce.naver.com`) —
  every live-NAVER CLI targets the **seller center** (review/export). `classifySessionVerdict` is tuned
  to `isSellerCenterUrl`. So **API-center issuance-state detection has no harness, and selectors must
  not be invented** (standing rule). This splits G3-C:

| Sub-walk | What | Tooling | Runnable now? |
|---|---|---|---|
| **G3-C.1** | NAVER **session/login** readiness calibration | `probe-session.ts` (existing, read-only) | **Yes — under a fresh G6** |
| **G3-C.2** | **API-center** issuance-flow observation | **none** — needs an offline harness built first | **No** — see §5 |

**This preflight is for G3-C.1.** G3-C.2 is deferred to §5 (offline prerequisite), so this first live
walk stays tightly scoped, read-only, and grounded in real tooling.

---

## 1. Scope (this walk)

- Assisted **session-readiness calibration** for first-time NAVER guided connection: does the dedicated
  profile + CDP reach a **logged-in** live NAVER surface, and do the sanitized session/hydration signals
  reflect it correctly enough to later replace the wizard's login **attestation** with **detection**?
- **In scope:** real local Chrome, dedicated NAVER profile, operator-performed login, one read-only
  no-click probe navigation, sanitized signal capture.
- **Explicitly OUT (per the stated G3-C scope):** no review-export click · no reply submit · no
  upload/DB/LAST_SUCCESS mutation · no connection-test/sync (that is a separate, more-mutating,
  separately-approved step) · no projection/crop UI · no API-center automated observation (G3-C.2).

## 2. Preconditions (all must hold before the command)

1. **Gates:** fresh **G3** (env + live-work pause lift, scoped *read-only*) **+ G6** (per-run approval)
   affirmed by the PO in the dispatching turn. G1 (channel), G2 (seller consent, own account/own screen),
   G4 (synthetic ladder green — the guided-connection wizard is offline-green, 634 FE tests), G5 (policy
   track) already stand or are non-blocking for a read-only probe.
2. **Operator seated & ready** (headed run — explicit "seated and ready"; a no-signal is operator-absent,
   not a code fault).
3. Operator has, in the **dedicated NAVER Chrome profile**, already **logged into NAVER themselves**
   (human-only login; 2FA/CAPTCHA by the operator; never bypassed).
4. Operator sets `collector/.env` `NAVER_REVIEW_URL` to their review-management page and
   `COLLECTOR_BROWSER_CHANNEL=chrome`. **I never read or echo these values;** the probe emits only a
   url-*category*, never the raw URL.

## 3. Exact command(s)

```bash
cd collector
set -a && . ./.env && set +a          # loads NAVER_REVIEW_URL + COLLECTOR_BROWSER_CHANNEL
npm run probe-session -- --i-understand-this-opens-live-naver
```

Nothing else runs. (`npm run probe-session` = `tsx src/cli/probe-session.ts`.) No other flag is passed;
the probe has no click, capture, upload, or backend path to enable.

## 4. Exact operator steps

1. Confirm seated & ready; confirm logged into NAVER in the dedicated profile.
2. Set `NAVER_REVIEW_URL` in `collector/.env` (operator-owned; not shared with me).
3. Run the command in §3 (or authorize me to, under the granted G6).
4. Chrome opens the **dedicated profile**, navigates to the URL, waits ≤15 s for the SPA to settle.
5. **Do not click anything in the page.** The probe is read-only/no-click by construction.
6. The probe prints one sanitized JSON blob; the browser context **auto-closes**.
7. **Abort immediately** (close the window) on any *unexpected* prompt/dialog, 2FA/CAPTCHA storm, or
   account lockout/warning, and report it. (There is no "expected export dialog" carve-out here — this
   walk triggers nothing.)

## 5. What the live run verifies

- The dedicated-profile + CDP launch **reaches the real NAVER surface while logged in** (environment
  readiness for guided connection).
- Whether the **sanitized session/hydration signals** correctly reflect the logged-in session — i.e., the
  calibration input for a future FE slice that replaces the wizard's login *attestation* with live
  *detection*. This is a **measurement**, not a pass/fail target.

## 6. Evidence emitted (sanitized only)

- The `extractProbeSignals` JSON on stdout + a matching `probe.done` log line: **url→category enum**
  (not the raw URL), hydration result (`hydrated` | `timeout`), `readyState`, app-root child **count**,
  and structural **presence booleans**. Scalars / enums / booleans only.

## 7. What must NOT be logged or saved (hard)

- Raw URL, raw HTML, page text, screenshots.
- Seller account id / store name / **Client ID / Client Secret**, and any order/review/customer/product
  data. (The probe already enforces sanitized-only, no-save; the **operator must also not paste** raw
  URLs/ids/secrets into any report or note.)

## 8. Success criteria (calibration)

- The probe completes, prints sanitized signals, and the context closes cleanly, **and** the signals give
  a usable read on the logged-in state — either confirming the markers or clearly exposing a
  marker/hydration mismatch to fix. Both are successful *calibration* outcomes.

## 9. Fail-closed criteria

- Missing approval flag → **refuses** (exit 3). Missing `NAVER_REVIEW_URL` → **refuses** (exit 2).
- The probe **never clicks** and **never infers an action**; ambiguous page state just yields signals.
- Any *unexpected* prompt/dialog / 2FA-CAPTCHA storm / lockout → **operator aborts immediately**; the run
  is reported as aborted, no retry-in-place.
- Nothing is persisted on failure (no partial capture, no status write).

## 10. Cleanup behavior

- `finally { await ctx.close() }` **always** closes the browser context. **No** file written, **no**
  upload, **no** DB, **no** `LAST_SUCCESS`, **no** collector-status mutation. The dedicated-profile
  session persists for the workday (by design) but **nothing is captured** from it.

## 11. Blockers this walk can lift / inform

- Partially lifts the wizard's **"login readiness = attestation-only"** limitation — measures whether
  live NAVER session detection is feasible (input to a follow-up **offline** FE slice that swaps
  attestation for detected state; no live NAVER needed to *build* that slice).
- Confirms **environment readiness** (dedicated profile + CDP reaches live NAVER) for guided connection.

## 12. Blockers that REMAIN after G3-C.1

- **API-center issuance-state detection** (G3-C.2) → §16.10 steps ②③ readiness stays manual/attested
  until an **offline** read-only observation harness is built (generic url-category + structural census,
  census-style like `discover-reply-target`, **no invented selectors**), tested offline, then run under a
  **separate** live G6. Until then, API-center calibration = **manual operator narration only** (sanitized,
  no runtime capture).
- **Live order-connection completion** (real `test-connection` + first `sync`) — a separate,
  more-mutating step needing its own pre-approval; **not** part of this read-only walk.
- Unrelated, unchanged: **B1** cross-source fingerprint, **B2** reply row selector, **B3** export
  `ARTIFACT_INVALID`, **B4** cold-restart persistence, **B5** autofill/Device Vault, **B7** Windows/Linux
  pairing.

## 13. G6 request (to be made AFTER this report, per instruction)

I will ask the PO for a **fresh single-use G3 (read-only scope) + G6** for **G3-C.1 only**, with the
operator seated & ready and `NAVER_REVIEW_URL` set by the operator. I will **not** launch any browser
until that is granted in the dispatching turn.
