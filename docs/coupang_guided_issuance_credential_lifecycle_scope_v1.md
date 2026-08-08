# Coupang Guided Issuance + Credential Lifecycle — Canonical Scope v1

> **Canonical reference** for what the Coupang WING guided-issuance and credential-lifecycle features are
> **live-proven**, **synthetic-only**, and **offline-only** as of this landing. Consolidates the scope of
> **PR #402** (guided issuance + WING walkthrough binding + already-issued live calibration) and **PR #403**
> (credential expiry + guided renewal). Read this before relying on any Coupang WING guided/renewal behavior.
>
> Detail lives in the feature docs: [`coupang_wing_guided_issuance_tutorial_v1.md`](./coupang_wing_guided_issuance_tutorial_v1.md),
> [`coupang_wing_live_calibration_v1.md`](./coupang_wing_live_calibration_v1.md),
> [`coupang_credential_expiry_guided_renewal_v1.md`](./coupang_credential_expiry_guided_renewal_v1.md),
> [`coupang_credential_expiry_audit_v1.md`](./coupang_credential_expiry_audit_v1.md).

## The four onboarding states — the whole of the seller-facing surface

Product-owner direction, 2026-08-08. Coupang connection onboarding has exactly four states, and SellerOps
offers nothing else on this surface:

| Seller state | SellerOps offers |
|---|---|
| **key 없음** | 신규 발급 guided tutorial (WING-resident overlay; the operator issues the key) |
| **key 이미 있음** | 기존 credential 연결 (masked entry → connect-test → sync) |
| **expiry / renewal 임박** | 재발급·갱신 guided flow (`coupang_credential_expiry_guided_renewal_v1.md`) |
| **credential invalid** | re-auth / reissue recovery — only the failure **diagnosis** half is built (`coupang_connection_failure_diagnostic_hardening_v1.md`); the recovery flow reuses the renewal path and is not yet a distinct surface |

**Key deletion is not one of them.** SellerOps never recommends deleting an existing Open API key and never
renders a deletion walkthrough to a seller. `COUPANG_WING_KEY_DELETION` is internal live-proof / diagnostic
tooling — see "Key deletion is out of scope" below and `docs/product-scope-v1.md` §7.19.

### The end-to-end target for the no-key state

The unfinished path this feature set is aimed at, end to end:

> SellerOps start → WING-resident overlay → **operator** issues the API key → SellerOps masked credential
> entry → connect-test → first sync → `CONNECTED`

Every step after "operator issues the API key" already exists in some form; what has never been exercised on
a real no-key WING account is the issuance form itself. That is what the next live unit measures.

## PR #402 — Guided Issuance + WING Walkthrough Binding

**LIVE-PROVEN** (real Coupang WING, observe-only, sanitized, 0 secret access, 0 발급 click):
- **Shared walkthroughRun binding** — SellerOps frontend + backend + Local Agent bind to one disposable run.
  Backend `/api/walkthrough/context` reports the channel + connector flag + run id; the handshake **matches**
  on the correct run + origin and **fails closed** on a stale/mismatched run. Channel-neutral, **no migration**.
- **Already-issued open-API page detection** — the WING page classifier recognizes the already-issued open-API
  page (via the live-confirmed credential-region anchor); verified across two independent captures. The
  `발급` and `Access Key` fixed-label anchors resolve uniquely with stable signatures.

**SYNTHETIC-ONLY** (not exercised on real WING):
- **The unissued (first-issuance) form** — 자체개발 / 업체명 / 호출 IP / the pre-issue checkpoint. The
  calibration account was already issued, so this screen was **not observable** and was **not fabricated**;
  **no `FIRST_ISSUANCE_FORM_LIVE_PASS` was recorded**. Its selectors stay `LIVE_DOM_CALIBRATION_PENDING`.
- **The full FE-driven real-WING guided walkthrough** end-to-end (SellerOps start → agent-hosted Action Window
  run → highlight on the live page → step-by-step advance → return) — calibration used the read-only recorder,
  **not** the full guided run. The guided walkthrough is offline-synthetic-verified.

## PR #403 — Credential Expiry + Guided Renewal

**OFFLINE-ONLY** (synthetic fixtures + offline E2E; **no live WING**):
- **Expiry warning** — computed `UNKNOWN / OK / WARN_30 / WARN_14 / WARN_7 / WARN_1 / DATE_PASSED / EXPIRED`
  from the stored exact expiry (WING-read or operator-confirmed; **never a 180-day estimate**). `EXPIRED`
  requires the date to have passed **AND** an auth failure — a 401 alone is never "expired". Alerts reuse
  dedup + acknowledgement (ack durably silences; cleared on renewal).
- **Guided renewal** — a WING renewal walkthrough (highlight 유효기간 / 재발급, human checkpoint before 재발급,
  agent reads no key) → masked credential **replace** screen; agent-unavailable → a manual text path.
- **Credential rollback** — the atomic replacement captures the old credential, stores the new one, verifies
  it, and on any failure (including a thrown verification) **restores the old credential** — it is never
  destroyed; the account, collected orders, and sync cursors are untouched throughout. **No migration.**

## Key deletion is out of scope (2026-08-08)

On 2026-08-08 a real Open API key **was** deleted on the operator-owned test account
(`coupang_wing_key_deletion_live_v1.md`). That was an **internal proof operation**, run to put the account
into a genuine no-key state so the first-issuance form could finally be observed — it was not the exercise of
a product feature, and it does not become one.

The deletion tooling therefore stays:

- **internal live-proof / diagnostic only** — CLI + gated shell harness, operator-run;
- **absent from every seller-facing tree** — fenced by
  `collector/test/crossstack/deletion-tooling-not-product-surface.test.ts`;
- **not a capability** — never labelled or promoted as one (`docs/product-scope-v1.md` §7.4 · §7.19);
- **feature-frozen** — no further development; regression protection only.

The pre-existing invariant is unchanged and still holds for the product: SellerOps performs **no** automatic
issue / re-issue / delete / reset of a key. In the deletion run the agent highlighted a control and rested at
a checkpoint; the operator performed the deletion. Agent click / type / submit remained 0.

## Not performed (explicit)

- **A real WING re-issuance / renewal live proof was NOT performed.** No live WING write, no key issuance or
  re-issuance, and no credential entry against real WING was done for the renewal or the unissued-form paths.
  Those remain future live-proof units (next: **Coupang WING Post-Delete Issuance Form Live Calibration v1** —
  READ_ONLY measurement of the real no-key form, then guided issuance).
- The one destructive live action that *was* performed is the internal key deletion above — operator-performed,
  and explicitly not a product path.

## Invariants (both PRs)

No auto issue/re-issue/delete/reset of a key; the Secret Key / Access Key / 업체코드 **value** is never read
(DOM / clipboard / log) — enforced by source guards and the driver interface shape; only sanitized
enums / booleans / counts / fixed labels / 16-hex signatures / (renewal) the one allowlisted `유효기간` date
cross any boundary; no order/shipping/product write; **no database migration**; the shared Action Window
contract is unchanged; NAVER and the existing Coupang order path are behavior-preserved.
