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

**Corrected after review — read this before relying on the verdict.** The first version claimed the form-marker
requirement made `not_issued` "positive evidence". It does not, on the path that matters:
`classifyWingPage` reaches `open_api_issuance` only when marker-or-anchor is present, so on that category an
absent anchor already *implies* the marker. The guard excludes nothing there, and the verdict reduces to
`!credentialAnchorPresent`. It is still worth keeping — it is what makes `credential_shown` fail closed and what
would catch a future classifier change — but it buys no resistance to a half-rendered page.

Two real limits follow, and both are now handled honestly rather than asserted away:

1. **Hydration.** WING paints its static shell — including the issuance heading — before the credential card's
   XHR resolves. A single read in that window is marker=true / anchor=false ⇒ `not_issued` while the key still
   exists. A single reading cannot separate "nothing to show" from "not shown yet".
2. **A bounded, top-document, exact-match scan.** `credentialAnchorPresent` comes from a scan that stops at a
   candidate cap and pierces no iframe or shadow root. Truncation is now reported by the census and forces
   `indeterminate` (`SCAN_TRUNCATED`), so page size alone cannot produce a false "deleted". The iframe / shadow
   / exact-label limits remain.

**So a single `not_issued` is a signal, not proof.** `wingDeletionEvidenceFrom` requires **two independent
readings that both say `not_issued`** before deletion evidence is recorded — the same two-capture standard the
WING signature calibration already uses. One disagreeing reading withholds the verdict entirely; it is not a
majority vote, because "mostly gone" is not a state worth reporting about an irreversible action.

The verdict is emitted on the probe record (`issuedState`) **and in the printed JSON**, so the next live run
carries it directly.

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

- `issuedState: not_issued` on **two independent probe runs** (⇒ `wingDeletionEvidenceFrom` reports
  `confirmedNotIssued: true` / `STABLE_NOT_ISSUED`) — this is the machine-verifiable post-state evidence the
  deletion currently lacks. A single run's `not_issued` is a signal only, for the hydration reason above. Two
  runs under one grant are fine: the probe is read-only and the scope is unchanged between them.
- `matchCount` recorded for each of `self_dev` / `vendor_info` / `call_ip` / `issue`
- uniqueness established for the targets a later guided walk must highlight
- leak 0 · code change 0 during the live run · no highlight / click / input / 발급

Three expectations worth setting now:

- `vendor_info` (업체명) matched **9×** on the already-issued page in the 2026-08-06 calibration, so it may well
  fail uniqueness again on the form — a finding to record, not a selector to retune by guesswork.
- The selectors must be corrected **only** from observed post-delete form evidence; the known issued-page
  results must not be used to pre-adjust them.
- `WING_OPEN_API_MARKER_LABELS` is itself **unvalidated** — it did *not* match on the already-issued page. Making
  `not_issued` a success criterion therefore creates pressure to retune those labels until the criterion fires.
  Do not. If the marker does not match the post-delete form, the correct outcome is `indeterminate` and a
  recorded finding, exactly as with any other placeholder (collector/CLAUDE.md §6).

Only after that unit: the WING-resident reissue tutorial, new key issuance, SellerOps credential replacement,
and connection/sync recovery — each its own unit with its own grant.

## Not done in this unit

No 발급 / 재발급, no form input, no credential value read, no credential replacement, no order sync, no
marketplace write of any kind. The Coupang connection remains down by design until a new key is issued **and**
the SellerOps credential is replaced.
