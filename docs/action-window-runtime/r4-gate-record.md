# R4 Supervised-Pilot Gate Record — NAVER SmartStore review export

**Opened:** 2026-07-12 · **Channel:** NAVER SmartStore review export (G1 ratified, [`decisions.md`](decisions.md) D-021).
**Pilot seller:** `NAVER_DEV_SELLER_SELF_01` — the operator's **own development NAVER seller account**
([`decisions.md`](decisions.md) D-024). **Status:** LIVING register of the §3 supervised-pilot gate.

> **This record authorizes NO live NAVER contact.** It records the gate state only. Live NAVER stays
> blocked until **G3** (stable environment + the NAVER live-work pause lift) and **G6** (explicit
> per-run approval in the dispatching turn) are both satisfied.

**Sanitization discipline (self-applied):** every value here is a label, enum, boolean, date, or SHA.
No raw seller/account ID, email, username, raw URL, credential, cookie, token, or profile path
appears — the pilot seller is referenced ONLY as the sanitized label `NAVER_DEV_SELLER_SELF_01`. This
is the same contract the adapter enforces on the wire and the persisted store.

This register is the source of truth for [`r4-preparation.md`](r4-preparation.md) §3 (G2/G3/G5/G6) and
the §8-1 gate row in [`r4-evidence-pack.md`](r4-evidence-pack.md).

---

## G1 — Channel ratified · ✅

NAVER SmartStore review export — [`decisions.md`](decisions.md) D-021 (2026-07-09). See
[`r4-preparation.md`](r4-preparation.md) §2 for the selection rationale.

---

## G2 — Seller consent · ✅ RECORDED (self-consent)

**The operating seller is the operator**, acting on their **own development NAVER seller account**
(label `NAVER_DEV_SELLER_SELF_01`). The seller consents to the §4 live-action safety boundary, which
this record acknowledges verbatim:

- **The seller (human) always:** logs in; completes 2FA/CAPTCHA/account-lock challenges; selects
  account/store; selects marketplace; selects period/scope; **clicks the real export/download
  control**; judges anything legally or semantically uncertain.
- **SellerOps (Runtime) only:** prepares/validates the session precondition; opens/foregrounds the
  dedicated real-Chrome window on the seller's own account; locates and **highlights** the one real
  control (salted signature, never a raw selector); **observes** the user's action; verifies the
  expected transition; **detects** download start/completion read-only; validates the artifact;
  continues downstream through the existing ingestion path; persists the audited Operation Run.
- **SellerOps never:** types credentials; bypasses/automates login/2FA/CAPTCHA; auto-selects
  account/store/marketplace; clicks the export control; expands one request into a hidden click
  sequence; runs unattended/scheduled; proceeds on ambiguity (0/many/drifted → fail closed, zero
  clicks); emits or persists selectors, URLs, page content, credentials, cookies, tokens, or paths.

**Scope of the first authorized live run:** the **read-only session-precondition probe only** (checks
`READY` vs a fail-closed blocker and stops — no locate/highlight/click/export/download/downstream).
The full §4 boundary above governs any later, separately-approved export pilot.

*Consent basis:* self-consent by the operator/product-owner (same person as the pilot seller),
affirmed by ratifying D-024 and this record. Satisfies [`r4-preparation.md`](r4-preparation.md) §1
**P7**.

---

## G3 — Environment · ☐ PENDING (operator confirms before the pause lift)

The §3 G3 preconditions. The operator confirms **each, in a stable environment**, before lifting the
NAVER live-work pause ([`r4-preparation.md`](r4-preparation.md) §9 item 3). Until then, all remain ☐
and no live run is authorized.

- ☐ Stable network / IP / location (the condition that paused NAVER live work).
- ☐ Dedicated Chrome profile for the connection.
- ☐ Bridge paired.
- ☐ Operation Run persistence enabled.
- ☐ **NAVER live-work pause LIFTED** for this specific run (the operator action that turns G3 green).

*Owner:* operator. G3 is not satisfied by this record.

---

## G4 — Synthetic ladder green · ✅

Every §6 adapter-readiness item green on NAVER fixtures — [`r4-evidence-pack.md`](r4-evidence-pack.md)
§8-2 (offline suite), §8-3 (headed human-click proof).

---

## G5 — Policy track · ✅ LOGGED

The §5 platform-policy/provider-inquiry state for the NAVER pilot (parallel track, D-019 — tracked
here, executed outside the repo):

| §5 item | State |
|---|---|
| Seller-tool / provider / API-partner program + prerequisites | ☐ not logged (not required for this pilot) |
| Written ToS question (seller-controlled overlay + read-only detection on the seller's own session) | ☐ not sent (not required for this pilot) |
| Platform position on third-party tools assisting (not automating) export | ☐ not recorded (not required for this pilot) |
| **NAVER-specific** | **None required** for a seller-owned export on the seller's own session per §5; Solution Market remains a long-term option, not a prerequisite. |

No platform is marked "승인됨/approved" (matrix §3 rule). The parallel track is **opened and logged** —
this satisfies [`r4-preparation.md`](r4-preparation.md) §1 **P8**. It does **not** authorize any live
action; live is governed by G3 + G6.

---

## G6 — Per-run approval · ☐ TEMPLATE (filled in the dispatching turn — a blank template grants nothing)

Explicit product-owner approval is required **in the dispatching turn** of each live run. It is never
standing and never inherited from prior approvals or goal pressure. To authorize a run, fill and
record one instance below (append per run; a blank template is not an approval):

```
R4 live-run approval
- channel:            NAVER SmartStore review export
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               <YYYY-MM-DD>
- operator:           <operator>
- run scope:          <read-only session-precondition probe | export pilot>
                      (first run MUST be: read-only session-precondition probe — no click/export/download)
- §7 abort criteria:  acknowledged (ambiguous/missing/drifted target, unexpected post-state,
                      session invalid, artifact-validation failure → fail closed, zero clicks;
                      operator abort on withdrawn consent / unrecognized dialog / anti-abuse challenge)
- G2/G3/G5 state:     G2 ✅ recorded · G3 ✅ confirmed (checklist above all ☑, pause lifted) · G5 ✅ logged
```

*Approvals recorded:* **none.** G6 is not satisfied by this record.

---

## Gate summary

- **G1 ✅ · G2 ✅ · G4 ✅ · G5 ✅.**
- **G3 ☐** (stable environment + NAVER live-work pause lift) and **G6 ☐** (per-run approval) are the
  **only remaining live gates** — both operator/PO-owned, neither Runtime code.
- The first authorized live contact is the **read-only session-precondition probe**; its sanitized
  `{ ready, verdict, blockerCode }` result is then recorded into
  [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-4.

## Related

- Gate definitions + readiness → [`r4-preparation.md`](r4-preparation.md) §3/§4/§5/§9
- Durable decisions → [`decisions.md`](decisions.md) D-019/D-021/D-024
- Dated readiness evidence → [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-1/§8-5
- Living handoff state → [`current-state.md`](current-state.md)
