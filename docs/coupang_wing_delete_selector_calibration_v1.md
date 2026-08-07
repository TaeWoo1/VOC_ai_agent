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
- The deletion driver imports `engine.ts` **type-only** and is not wired to `engine.ts` / `session.ts` /
  `verifier.ts`, the only places a signature is compared (`UI_DRIFT`). Even there the comparison is
  locate-vs-verify **within one run**, both sides computed live — never against a stored constant. Every
  hardcoded 16-hex literal in `src/` is a synthetic guidance signature or a fixture/artifact default, and none
  is compared against a live delete-path signature. (`esm-candidate-signature.ts` does compare a persisted
  signature, but that is the ESM review-scheduling subsystem — unreachable from the deletion path.)

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
| Already-issued page classification, then a **unique** 삭제 match, then a **verified-painted** irreversible-warning checkpoint | driver |
| The operator's own press of 삭제 | operator |

The destructive manifest's `channel` / `surface` / `operation` / `maxActions` are **pinned to the phase spec**
(`COUPANG_WING_KEY_DELETION_SCOPE`) and no longer read from the environment; any deviation is refused with
`DESTRUCTIVE_SCOPE_MISMATCH`. The operator's one-line grant binds to exactly those fields, so a leftover `.env`
from another run must not be able to print a destructive manifest that describes a different run. Pinning also
resolved a real drift: the runtime CLI and the display CLI had been declaring **different** action budgets.

The approval gate **still defaults every WING phase to uncalibrated** and never imports the driver flag — the
caller must state the calibration, so a caller that forgets it gets `SELECTORS_NOT_CALIBRATED` rather than
inheriting another surface's calibration. Two callers state it, both from the same constant: the runtime CLI
`run-coupang-wing-deletion-live.ts` and the manifest **display** CLI `approval-manifest-cli.ts`. That pairing is
required — without it the run would be executable while the manifest the grant binds to could never be printed.
Withdrawing the flag closes both at the same instant; that direction is tested.

Agent marketplace click / type / submit budget remains **zero**. `PREPARED` is not `APPROVED`.

## The checkpoint renders in the resident panel

`highlightDeleteCheckpoint` mounts the overlay with `residentPanel: true` and **no advance button**. This is a
safety requirement, not styling: without the resident panel the ~130-character irreversible warning renders in
the spotlight ring's single-line `nowrap` badge and runs off the viewport — the operator would press an
irreversible 삭제 having never read the checkpoint the manifest's `explicitCheckpointRequired: true` promises.
No advance button is added because this walk advances on the operator's sentinel file, so the checkpoint
introduces no interactive element onto the marketplace page — and a panel with no button now takes
`pointer-events: none`, so it can never sit over the control the operator must press.

The mount is also **verified**, not assumed. `mountOverlay` returns silently when the tagged element is gone
(the SPA re-rendered during the settle sleep, or `activePage()` resolved to a newly-opened tab), so awaiting it
proves nothing; without a check the phase would reach `highlighted` — the only precondition `verifyDeletion`
tests — with no ring and no warning painted. The driver now asks `overlayMounted` and reports `count: 0` rather
than advancing on a phantom checkpoint.

Tests assert the overlay's actual content (warning copy, `residentPanel`, no `advance`), that a silently
unmounted checkpoint fails closed, and that **no refused path mounts an overlay at all**.

## Not established by this unit

1. **Cross-run signature stability for `delete`** — one capture (see above).
2. **Any live deletion.** No key was deleted, highlighted, or clicked. `DELETED_KEY_REISSUANCE_PATH_LIVE_PASS`
   is **not** recorded and the post-delete page/form is uncalibrated (`isKeyGoneCategory` accepts only a clear
   navigation to `wing_home`, conservatively reporting `deleted: false` on anything ambiguous).
3. **The other five WING targets.** Scope was `delete` only; `vendor_info` / `self_dev` / `call_ip` remain as
   [`coupang_wing_live_calibration_v1.md`](./coupang_wing_live_calibration_v1.md) left them, and
   `WING_HIGHLIGHT_CALIBRATION` stays `LIVE_DOM_CALIBRATION_PENDING`.
4. **The full guided deletion walk end-to-end live.** Offline-synthetic-verified only.

## Known gaps in the destructive path (pre-existing; NOT closed by this unit)

Surfaced by review of this landing. Latent before it (the destructive phase could never reach PREPARED, so no
destructive manifest could be mis-described); live the moment it landed. The scope-pinning gap was closed here;
this one was not, and it should close before `Coupang WING Key Deletion Live v1`:

- **Identity binding is presence-only, not freshness.** `validateApprovalPrerequisites` accepts any non-empty,
  non-`"unknown"` `runId` / `approvalId` / `gitSha`; nothing compares `WALKTHROUGH_GIT_COMMIT` to actual HEAD
  or checks a clean tree. The WING *probe* has that protection in `wing-probe-preflight.sh`; the deletion
  entrypoint has **no equivalent preflight harness**, so a leftover `.env` from a consumed approval can reach
  PREPARED with a `gitSha` that does not describe the running code — which the approval contract treats as
  `REVOKED`. A deletion preflight harness (the probe harness's destructive sibling) is the obvious fix and is
  a unit of its own.

## Withdrawing the calibration

`WING_DELETION_SELECTORS_CALIBRATED = false` is the single emergency lever: it closes the runtime CLI and the
manifest display CLI at the same instant. Pulling it costs **exactly one** deliberate red test — the intent
marker in `coupang-wing-deletion-driver.test.ts` — which exists as the confirmation prompt. Every other test
either states its own calibration or branches on the constant, so nobody has to edit tests under pressure to
close the destructive path.

## Next unit

`Coupang WING Key Deletion Live v1` — a destructive, operator-performed run requiring its own fresh bootstrap,
fresh destructive manifest, and fresh single-use grant. It is **not** authorized by this document.
