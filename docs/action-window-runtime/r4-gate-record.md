# R4 Supervised-Pilot Gate Record — NAVER SmartStore review export

**Opened:** 2026-07-12 · **Channel:** NAVER SmartStore review export (G1 ratified, [`decisions.md`](decisions.md) D-021).
**Pilot seller:** `NAVER_DEV_SELLER_SELF_01` — the operator's **own development NAVER seller account**
([`decisions.md`](decisions.md) D-024). **Status:** LIVING register of the §3 supervised-pilot gate.

> **This record authorizes NO live NAVER contact beyond what a filled per-run G6 grants.** It records the
> gate state only. A **read-only session-precondition probe was completed 2026-07-12** under a **consumed
> one-run G6** (§G6 below, §8-4 result). **Live export stays blocked** — it needs **G3** (stable
> environment + a live-work pause lift under the full §4 scope) and a **fresh per-run G6** in the
> dispatching turn; the consumed read-only-probe instance carries over to nothing.

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

## G3 — Environment · ✅ CONFIRMED 2026-07-12 (read-only probe path only)

The §3 G3 preconditions, confirmed by the operator **in a stable environment**. The pause lift below
is **scoped to the first read-only session-precondition probe only** ([`r4-preparation.md`](r4-preparation.md)
§9 item 3) — it is **not** a blanket lift of the NAVER live-work pause.

- ☑ Stable network / IP / location (the condition that paused NAVER live work).
- ☑ Dedicated Chrome profile for the connection.
- ☑ Bridge paired.
- ☑ Operation Run persistence enabled.
- ☑ **NAVER live-work pause LIFTED** — **for the first read-only session-precondition probe only**
  (no click / export / download); not a general lift.

*Owner:* operator. *Confirmed:* 2026-07-12 — G3 satisfied **for the read-only probe path**. This alone
authorizes **no live contact**: G6 per-run approval is still required in the dispatching turn before any
probe.

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

*Approvals recorded:* one **CONSUMED** read-only-probe instance (below). G6 is a **per-run** gate — it is
never permanently satisfied, and this record grants nothing beyond the single run it describes.

```
R4 live-run approval — CONSUMED (authorizes nothing further)
- channel:            NAVER SmartStore review export
- seller-account:     NAVER_DEV_SELLER_SELF_01
- date:               2026-07-12
- operator:           self
- run scope:          read-only session-precondition probe (no click/export/download)
- §7 abort criteria:  acknowledged
- G2/G3/G5 state:     G2 ✅ · G3 ✅ (read-only probe path) · G5 ✅
- outcome:            CONSUMED — one read-only probe executed 2026-07-12; sanitized result in
                      r4-evidence-pack.md §8-4 (ready / LOGGED_IN / seller-center; no blocker).
                      Read-only held: no click/locate/highlight/export/download/quarantine/
                      ingest/downstream/status write. Authorized ONLY this one read-only probe.
                      NOT an export pilot.
```

This instance is **spent**. Each subsequent live run — **including any export pilot** — requires a **NEW**
G6 instance filled in that dispatching turn under the full §4 boundary. Goal pressure, prior approvals,
or this consumed instance never carry over.

---

## Gate summary

- **G1 ✅ · G2 ✅ · G3 ✅ · G4 ✅ · G5 ✅.** (G3 confirmed 2026-07-12 for the read-only probe path;
  pause lift is scoped to that probe only.)
- **G6 is a per-run gate** — a **read-only-probe instance was approved and consumed 2026-07-12** (the
  §8-4 probe is complete). G6 is **never standing**: an **export pilot still requires a fresh per-run G6**
  in the dispatching turn, operator/PO-owned, not Runtime code.
- The first authorized live contact — the **read-only session-precondition probe** — **was completed
  2026-07-12**; its sanitized `{ ready, verdict }` result (`ready:true` / `LOGGED_IN`, no blocker) is
  recorded in [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-4. The next live step (export pilot) needs a
  **new** G6 under the full §4 boundary.

## Related

- Gate definitions + readiness → [`r4-preparation.md`](r4-preparation.md) §3/§4/§5/§9
- Durable decisions → [`decisions.md`](decisions.md) D-019/D-021/D-024
- Dated readiness evidence → [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-1/§8-5
- Living handoff state → [`current-state.md`](current-state.md)
