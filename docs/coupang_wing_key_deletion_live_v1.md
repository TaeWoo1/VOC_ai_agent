# Coupang WING Key Deletion — Live v1

> **Status:** `COUPANG_WING_KEY_DELETION_LIVE_PASS` for the guided destructive walk, 2026-08-08, on
> `main @ e798e910`. Real Coupang WING, operator-performed deletion of a real self-developed Open API key,
> fully sanitized. **Agent click / type / submit on the marketplace: 0.**
>
> **The deletion outcome itself is operator-attested, not agent-confirmed** — see "What the tool could not
> see". This is **not** `DELETED_KEY_REISSUANCE_PATH_LIVE_PASS`; no key was issued or reissued, and no
> SellerOps credential was replaced.
>
> Approval rules: [`sellerops_live_approval_contract.md`](./sellerops_live_approval_contract.md). Selector
> provenance: [`coupang_wing_delete_selector_calibration_v1.md`](./coupang_wing_delete_selector_calibration_v1.md).

## The run

Identity `wt-8a396f64610f` / `apr-07a5c5afbec2`, pinned to `e798e910` with a clean tree, verified by both the
display CLI and the runtime CLI (`repo-identity.ts`). A stale run env from a review agent (pinned `117f5965`)
was discarded before bootstrap; it would have refused on HEAD drift anyway.

| Step | Time (KST) | Observable |
|---|---|---|
| dedicated Chrome opened | 13:49:05 | headed, bundled Chromium, dedicated profile |
| operator logged in + navigated | — | agent performed no navigation |
| ready signal | 13:51:16 | operator-initiated |
| page classified | 13:51:16 | `pageCategory: open_api_issuance`, `ok: true` |
| 삭제 located + highlighted | 13:51:17 | `matchCount === 1`, checkpoint **painted and verified** |
| operator pressed 삭제 | — | agent did nothing; any confirmation modal was the operator's |
| completion signal | 13:53:02 | operator-initiated |
| post-delete read | 13:53:02 | `deleted: false`, `pageCategory: open_api_issuance` |
| teardown | 13:53:02 | exit 0, 0 Chrome processes, sentinels cleaned |

Safety invariants held throughout: 0 agent clicks/types/submits, 0 credential value reads, 0 raw DOM / HTML /
screenshot / clipboard / PII, 0 code change during the run (clean at `e798e910` before and after), grant
consumed at window open.

## What the tool could not see

`deleted: false` is the driver's conservative verdict: `isKeyGoneCategory` accepts only a clear navigation to
`wing_home`. It is **not** evidence the deletion failed — and it is not evidence it succeeded either.

The sharper problem is that `pageCategory` **cannot distinguish the two states at all** on this surface:

- the already-issued page classifies as `open_api_issuance` via the **credential anchor**;
- the post-delete issuance **form** classifies as `open_api_issuance` via the **form marker**.

Same category, opposite meanings. So the category carried no information about this deletion in either
direction, and the outcome is recorded as **operator-attested**.

This was predicted and disclosed *before* the grant, not discovered afterwards. It is fixed for next time —
see below.

## Fix 1 — the issued-state verdict (`wingIssuedStateFrom`)

`credentialAnchorPresent` was already in the probe's observation; nothing turned it into a verdict. Now:

| Observation | Verdict |
|---|---|
| credential anchor present | `issued` |
| **no anchor + form marker present** | **`not_issued`** ← the machine-verifiable post-delete evidence |
| no anchor, no form marker | `indeterminate` (`THIN_SIGNALS`) |
| not the open-API surface | `indeterminate` |
| no observation / observe threw | `indeterminate` |

The asymmetry is deliberate and load-bearing: `not_issued` requires **positive** form-marker evidence. A page
that failed to load, hydrated late, or rendered an error also lacks the credential anchor — treating that as
"the key is gone" would let a broken read masquerade as deletion evidence, which is the one mistake this
verdict must never make. `indeterminate` is the *absence* of evidence, never evidence of the opposite.

The verdict is emitted on the probe record (`issuedState`), so the next live run carries it directly.

## Fix 2 — the checkpoint now retires on the completion signal

The operator reported that after pressing 삭제, the ring and the irreversible-warning panel stayed up. They
did: `clearHighlight()` only ran in the `finally` block, so the guidance survived the verify poll and the whole
window between the click and the completion signal.

On a destructive surface that is not cosmetic. The ring points at a control that may no longer exist while the
panel still reads "press 삭제" — instructing the operator to repeat an action they already took, on a page that
may now offer 발급 in a similar position. Stale destructive guidance invites a second attempt.

`finishDeletionRun` now clears **before** verifying, on **every** signal (completion, abort, timeout). The
driver cannot detect the click itself — it deliberately attaches no listeners to marketplace controls — so the
completion signal is the earliest possible moment, but it is far earlier than before. A clear that fails is
reported as `checkpointCleared: false`, never retried, and never allowed to block or re-trigger anything;
clearing does not reset the driver's phase, so the checkpoint-before-operator-action invariant is untouched.

## Next unit — `Coupang WING Post-Delete Issuance Form Live Calibration v1`

**No new phase or harness is needed.** `COUPANG_WING_SELECTOR_PROBE` already measures these targets READ_ONLY
under a scoped, gated harness; the scope is part of what the operator approves, and the runtime refuses unless
the approved and runtime scopes are equal.

```bash
SELLEROPS_WING_PROBE_TARGETS=self_dev,vendor_info,call_ip,issue \
  tools/coupang-local/wing-probe-bootstrap.sh
tools/coupang-local/wing-probe-preflight.sh      # displays the READ_ONLY manifest; then a fresh grant
```

Scope is the four **form** targets only — deliberately not `credentials` or `delete`, which cannot exist after
a deletion and would guarantee two non-unique candidates that muddy the signal.

Success criteria for that unit:

- `issuedState: not_issued` (⇒ `credentialAnchorPresent=false` with positive form-marker evidence) — this is
  the machine-verifiable post-state evidence the deletion currently lacks
- `matchCount` recorded for each of `self_dev` / `vendor_info` / `call_ip` / `issue`
- uniqueness established for the targets a later guided walk must highlight
- leak 0 · code change 0 during the live run · no highlight / click / input / 발급

Two expectations worth setting now: `vendor_info` (업체명) matched **9×** on the already-issued page in the
2026-08-06 calibration, so it may well fail uniqueness again on the form — that is a finding to record, not a
selector to retune by guesswork. And the selectors must be corrected **only** from observed post-delete form
evidence; the known issued-page results must not be used to pre-adjust them.

Only after that unit: the WING-resident reissue tutorial, new key issuance, SellerOps credential replacement,
and connection/sync recovery — each its own unit with its own grant.

## Not done in this unit

No 발급 / 재발급, no form input, no credential value read, no credential replacement, no order sync, no
marketplace write of any kind. The Coupang connection remains down by design until a new key is issued **and**
the SellerOps credential is replaced.
