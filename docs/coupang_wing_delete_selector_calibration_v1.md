# Coupang WING Delete Selector — Live Calibration Landing v1

> **Status:** `DELETE_SELECTOR_LIVE_CALIBRATION_PASS`, captured 2026-08-07 on `main @ a666ad1`. Real Coupang
> WING, an **already-issued** account, fully sanitized. **Zero 삭제 press, zero highlight, zero click/type,
> zero credential value read, zero raw DOM / HTML / screenshot / URL / PII.** This document is the provenance
> for flipping `WING_DELETION_SELECTORS_CALIBRATED` to `true`; the code-level record is
> `WING_DELETION_CALIBRATION_EVIDENCE` in `collector/src/action-window/coupang-wing-issuance-driver.ts`.
>
> Companion: [`coupang_wing_live_calibration_v1.md`](./coupang_wing_live_calibration_v1.md) (the earlier
> `issue` / `credentials` / page-detection calibration). Approval rules:
> [`sellerops_live_approval_contract.md`](./sellerops_live_approval_contract.md).

## The capture

One read-only delete-only probe run, under a single-use operator grant against a displayed
`COUPANG_WING_SELECTOR_PROBE` manifest (`READ_ONLY`, `probeTargets: ["delete"]`, approved scope == runtime
scope). The operator logged in and navigated themselves; the agent performed **no navigation, click, or
input** and waited for an explicit operator ready signal. A first attempt the day before timed out with no
ready signal (no measurement, reported as not-a-pass); this retry ran on identical tooling with **zero code
change**, verified clean at `a666ad1` before and after.

| Measured | Value |
|---|---|
| Sanitized record id | `wingrec_c01e673ebc61` |
| URL category | `wing_host` (raw URL never captured) |
| Page category | `open_api_issuance` — via `credentialAnchorPresent: true` |
| `delete` matchCount | **1** (unique) |
| `canHighlight` | `true` |
| Role / label | `button` / `삭제` (our own fixed label) |
| Opaque structural signature | `3562cb60c496e220` |
| Faults / aborts | 0 |

Consistent with the earlier calibration, `openApiMarkerPresent` was `false` — the already-issued page is
identified by the credential anchor, not the form marker.

## The locator is unchanged — deliberately

The uniqueness was measured against the **existing proposed spec**, byte for byte:

```ts
delete: { candidateQuery: "button,a,span,div", exactText: "삭제" }
```

It was **not** retuned to the observed `role: "button"`. Narrowing the query would measure something other
than what was calibrated and would discard the evidence justifying the flip. A guard test locks the spec to
this exact value; changing it requires re-running the read-only probe. `role` is recorded as provenance only —
the locator does not filter on it.

## What `sig16` is, and is not

**`sig16` is evidence metadata, not a runtime safety anchor.** Audited against the code at `a666ad1`:

- `CoupangWingDeletionDriver.probeDeleteMatch()` surfaces the signature only as sanitized probe output.
- `highlightDeleteCheckpoint()` returns it, but `run-coupang-wing-deletion-live.ts` checks `count` and
  **discards the sig**. `verifyDeletion()` compares nothing — it reads a page-category enum.
- The deletion driver is not wired to `engine.ts` / `session.ts`, the only places a signature is compared
  (`UI_DRIFT`). Even there the comparison is locate-vs-verify **within one run**, both sides computed live —
  never against a stored constant. The only hardcoded 16-hex sigs in `src/` are synthetic constants for
  guidance-only targets that have no DOM element.

**Consequence:** no code path requires the signature to be stable across runs, so **one capture is a complete
basis** for the uniqueness claim, and a second capture was not required for this landing.

**Corollary (enforced by test):** introducing a cross-run signature-anchor comparison would *create* a
stability requirement that one capture cannot honestly satisfy. `WING_DELETION_CALIBRATION_EVIDENCE` records
`captureCount: 1`, `signatureStability: "SINGLE_CAPTURE_NOT_ESTABLISHED"`, and
`signatureRole: "EVIDENCE_ONLY"`; a guard test asserts neither the deletion driver nor its CLI reads the
recorded evidence or the sig literal. Wiring such an anchor is a **`Delete Selector Stability Capture v1`**
unit — a second independent delete-only capture under a fresh grant — not an incidental refactor.

## What the flip does and does not change

`WING_DELETION_SELECTORS_CALIBRATED = true` asserts **selector readiness only**. The destructive entrypoint
`run-coupang-wing-deletion-live.ts` is now *executable*, but every other gate is unchanged:

| Still required | Layer |
|---|---|
| `--i-understand-this-opens-live-coupang-wing` (a NAVER grant never opens WING) | CLI flag |
| WING/auth host screening before Chrome launches | `screenWingUrl` |
| A PREPARED destructive Approval Manifest for a bound, fresh `WALKTHROUGH_*` identity | `validateApprovalPrerequisites` |
| The immutable operator-destructive descriptor (irreversible, agent-performs-nothing, checkpoint required, 0 value reads) | approval gate |
| A fresh, single-use operator grant against the displayed manifest | operator |
| Already-issued page classification, then a **unique** 삭제 match, then the irreversible-warning checkpoint | driver |
| The operator's own press of 삭제 | operator |

The approval gate **still defaults every WING phase to uncalibrated** and never imports the driver flag — the
caller must state the calibration, so a caller that forgets it gets `SELECTORS_NOT_CALIBRATED` rather than
inheriting another surface's calibration. Withdrawing the flag closes the whole destructive path in one place;
that direction is tested.

Agent marketplace click / type / submit budget remains **zero**. `PREPARED` is not `APPROVED`.

## Not established by this unit

1. **Cross-run signature stability for `delete`** — one capture (see above).
2. **Any live deletion.** No key was deleted, highlighted, or clicked. `DELETED_KEY_REISSUANCE_PATH_LIVE_PASS`
   is **not** recorded and the post-delete page/form is uncalibrated (`isKeyGoneCategory` accepts only a clear
   navigation to `wing_home`, conservatively reporting `deleted: false` on anything ambiguous).
3. **The other five WING targets.** Scope was `delete` only; `vendor_info` / `self_dev` / `call_ip` remain as
   [`coupang_wing_live_calibration_v1.md`](./coupang_wing_live_calibration_v1.md) left them, and
   `WING_HIGHLIGHT_CALIBRATION` stays `LIVE_DOM_CALIBRATION_PENDING`.
4. **The full guided deletion walk end-to-end live.** Offline-synthetic-verified only.

## Next unit

`Coupang WING Key Deletion Live v1` — a destructive, operator-performed run requiring its own fresh bootstrap,
fresh destructive manifest, and fresh single-use grant. It is **not** authorized by this document.
