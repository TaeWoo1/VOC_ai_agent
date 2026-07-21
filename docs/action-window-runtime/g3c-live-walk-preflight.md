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
- ~~**Nothing in `collector/src` observes the NAVER *API center*** (`apicenter.commerce.naver.com`) —
  every live-NAVER CLI targets the **seller center** (review/export)... So **API-center issuance-state
  detection has no harness**.~~ **CORRECTED 2026-07-21 — that statement is STALE.** The rest of the
  standing rule is unchanged and still binding: `classifySessionVerdict` is tuned to `isSellerCenterUrl`,
  and **selectors must not be invented**. This splits G3-C:

| Sub-walk | What | Tooling | Runnable now? |
|---|---|---|---|
| **G3-C.1** | NAVER **session/login** readiness calibration | `probe-session.ts` (existing, read-only) | **Yes — under a fresh G6** |
| **G3-C.2** | **API-center** issuance-flow observation | ~~none~~ **`observe-api-center.ts` (EXISTS — read-only, no-click)** | **Yes — under a fresh G6**, but ⛔ **NOT v1-gating** (see below) |

**This preflight was written for G3-C.1.** G3-C.2 was deferred to §5 as an offline prerequisite; that
prerequisite has since been **built** — `collector/src/cli/observe-api-center.ts` is a read-only,
no-click, guided-tutorial API-center **page-category** observer with a two-checkpoint manual-navigation
journey model.

> ### ✅ RULED 2026-07-21 (PO) — G3-C is NOT a v1 gate
>
> - **G3-C.1 and G3-C.2 are NOT v1 gating.** NAVER v1 onboarding completes at **G3-A/B**; G3-C/D are
>   **post-v1** (`docs/slices/naver-guided-connection.md` §0; v1 plan §9).
> - **Live API-center observation is diagnostic / tool-calibration evidence only.** **G3-C.2 live runs
>   DID occur in this workstream**, but **only** for sanitized page-category observation and calibration
>   of the `observe-api-center` classifier (the classifier's documented precedence corrections are
>   live-derived). They are **not** a product path and are **not** a v1 verification item.
> - **What those runs do NOT prove:** first-time issuance completion · marketplace-policy permission ·
>   credential extraction (**never attempted — SellerOps never reads Client ID/Secret**) · connection-test
>   or `sync` success for a **freshly issued** app.
> - ⚠ **Boundary preserved.** API-center work is **guided tutorial support only**: no automatic API
>   issuance, no automatic linking, no click/type/submit on the API center, and **SellerOps never reads
>   Client ID / Secret from the page** — the seller creates/opens the app and copies the values manually.
> - **No live run is scheduled.** Any further API-center live contact is a **diagnostic exception**
>   requiring a fresh, single-use, in-turn **G3 + G6** named in the dispatching turn plus seated-and-ready,
>   and it never rides on a generic live grant.

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

- **API-center issuance-state detection** (G3-C.2) → **RULED 2026-07-21 (PO): this is NOT a v1 blocker.**
  §16.10 steps ①② ship in v1 as **tutorial-guided with seller self-attestation**, and that is the accepted
  v1 bar — not a gap awaiting live detection. The offline harness this section anticipated **has since been
  built** (`observe-api-center.ts`, read-only / no-click / no invented selectors) and has a **diagnostic
  calibration history**; that history is **evidence about the tool**, not a v1 verification item and not a
  product path.
- **Live order-connection completion** (real `test-connection` + first `sync`) — a separate,
  more-mutating step needing its own pre-approval; **not** part of this read-only walk. **RULED 2026-07-21
  (PO): an assisted end-to-end onboarding walk against a real, FRESHLY ISSUED NAVER app is POST-v1.** It
  would mutate the **Vault and the local DB** (credential store → `test-connection` → `sync`), needs
  **separate PO approval plus a fresh single-use G6** when it eventually runs, and **must not be claimed
  as v1-verified**. (The 2026-06-14 ORDER_SUMMARY live verification used an already-configured account and
  does **not** cover the first-time-issuance path.)
- Unrelated, unchanged: **B1** cross-source fingerprint, **B2** reply row selector, **B3** export
  `ARTIFACT_INVALID`, **B4** cold-restart persistence, **B5** autofill/Device Vault, **B7** Windows/Linux
  pairing.

## 13. G6 request (to be made AFTER this report, per instruction)

I will ask the PO for a **fresh single-use G3 (read-only scope) + G6** for **G3-C.1 only**, with the
operator seated & ready and `NAVER_REVIEW_URL` set by the operator. I will **not** launch any browser
until that is granted in the dispatching turn.
