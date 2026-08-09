# Coupang WING Delete Calibration Withdrawal v1

**Status:** landed · offline unit · no live run, no WING window, no probe, nothing deleted
**Withdraws:** `docs/coupang_wing_delete_selector_calibration_v1.md`
**Trigger:** the calibration-landing review, which found `WING_DELETION_CALIBRATION_EVIDENCE.role` documented as
*"as measured"* while it had never been measured

## Two grounds, and the second is the serious one

**1. `role: "button"` was never measured.** It came from `WING_TARGET_EXPECTED_ROLE.delete` — the hardcoded table
of *expected* roles — written into a field named `role` and documented "as measured". This is byte-for-byte the
over-claim that got the 발급 calibration refuted on 2026-08-09. That much was already known when this unit
started.

**2. The uniqueness measurement predates the visibility filter.** This was not known, and it is what makes the
withdrawal necessary rather than tidy.

| | |
|---|---|
| the 삭제 capture ran at | `a666ad1` · 2026-08-07 |
| `paints()` was added to the shared locator at | `a3ef479e` · 2026-08-09 |

So `matchCount: 1` was produced by the *same locator version* that, on the 발급 target, returned a confident
unique match against a node that does not render — and told an operator to press it.

The resemblance is not loose. The refuted 발급 spec was `{"button,a,span,div", "발급"}`; the 삭제 spec is
`{"button,a,span,div", "삭제"}`. Same broad multi-tag query, same short whole-text label, same page family,
same unfiltered code. Whether that `1` was a painting 삭제 button or a hidden node is **unknown**, and the record
never had a field that could tell the difference.

## A third state, because the two existing ones both lie about it

`LIVE_DOM_CALIBRATION_APPARATUS_UNSOUND`.

- `PENDING` would say nobody looked. Somebody did.
- `REFUTED` would say somebody looked and the claim was disproved. Nobody re-ran it.

The claim is **unsupported, not disproved** — and that is the state most likely to be quietly rounded up to
"probably fine", which is exactly the rounding this codebase keeps paying for. The obligation it carries is
narrower than refuted and stricter than pending: the old capture may not be re-cited, and the only way out is a
fresh measurement on the current apparatus.

## What changed

| | |
|---|---|
| `WING_DELETION_SELECTORS_CALIBRATED` | `true` → **`false`** |
| `WING_DELETION_CALIBRATION` | `CONFIRMED` → `APPARATUS_UNSOUND` |
| `role: "button"` | **deleted**, not renamed — the expectation already has a home |
| `matchCount` / `canHighlight` | folded into `withdrawnObservation: { matchCount: 1, visibilityFiltered: false }` |
| `sig16` | → `withdrawnSig16` (the signature of whatever the unfiltered locator matched) |
| new | `withdrawnOn`, `visibilityFilterAddedIn`, `deletionOutcome: "NEVER_PERFORMED"`, `reconfirmationRequires` |

**The selector itself is unchanged**, deliberately. A withdrawal is not a licence to guess a new one: the capture
is unsupported rather than disproved, so editing the spec now would mean the eventual re-measurement measures
something nobody ever observed, and would destroy the only clean comparison available.

**No new probe, no live measurement, no deletion-feature change.** This unit closes a false claim; it does not
open an investigation.

## What the withdrawal costs

Nothing that worked. **No live deletion run has ever been performed.** The destructive walk is now fail-closed at
every layer: the manifest gate refuses `SELECTORS_NOT_CALIBRATED`, the display CLI prints no manifest to grant
against, the preflight refuses, and the driver refuses to highlight. The internal-only / feature-frozen product
fence is unchanged, and the fence test still passes.

The asymmetry with 발급 — re-landed the same week, on one fresh measurement — is the point. The flag tracks
evidence, not confidence, and the destructive path is where an unmeasured but plausible claim costs the most.

## Keeping the withdrawal from deleting coverage

`SELECTORS_NOT_CALIBRATED` short-circuits ahead of every other refusal cause, so flipping the flag would have
silently disabled the destructive path's coverage of phase binding, unbound identity, host screening, pinned
scope, HEAD drift, dirty tree, wrong repository and unreadable git — a green suite testing nothing. Withdrawing
must change what the code *does*, not what the tests can *see*.

Both destructive entrypoints therefore gained the seam the reveal CLI already had, on the same contract:

- `run-coupang-wing-deletion-live.ts` — `gateRefusalCause(url, verifyIdentity, calibrated = WING_DELETION_SELECTORS_CALIBRATED)`
- `approval-manifest-cli.ts` — `opts.selectorsCalibrated ?? WING_DELETION_SELECTORS_CALIBRATED`

The default is the shipped constant in both, `main()` passes neither, and the seam is in-process only — no
environment variable reaches it. Tests pin all three, and the **withdrawn direction** is now the one the
uninjected default exercises: with everything else perfect, the gate must still refuse.

## The selfcheck now derives its expectation instead of asserting `true`

`wing-deletion-selfcheck.sh` hardcoded `"selectors calibrated: true"`, so the withdrawal would have turned it red
for being correct. It now reads the shipped constant (aborting, exit 3, if the constant is neither literal) and
runs one of two alternative halves:

- **calibrated** → the manifest half, unchanged
- **withdrawn** → a `WITHDRAWN` half asserting the refusal *and* that nothing approval-shaped is displayed beside
  it — no manifest, no destructive descriptor, no `selectors calibrated: true`, no grant line — plus that the
  refusal names a READ-ONLY probe as the way back

The skipped manifest cases are named **and counted**: the run exits **2 / `SELFCHECK PARTIAL`**, because on a
harness that gates an irreversible action, a green banner and exit 0 read as coverage to anything consuming the
exit code.

That accounting now covers the **dirty-tree** skip too. A first draft deferred it as "the known fail-open this
harness shares with `wing-probe-selfcheck.sh`"; review showed the framing was wrong — the reveal harness closed
it two units ago, and this file says elsewhere that the two must not drift. It was drift, not shared debt. Review
also caught that the new `WITHDRAWN` case was missing from the dirty-tree skip list entirely, so on a dirty tree
the only end-to-end check that the destructive path is closed silently did not run, was not named, and the
harness printed PASS. Both are fixed: `WITHDRAWN` is on the list, and either skip reason exits 2.

## Verification

- typecheck green; full collector suite **7547 passed / 142 skipped, 0 failed**
- `wing-deletion-selfcheck.sh` → **PARTIAL, exit 2**, WITHDRAWN half green, manifest cases named and counted
- `wing-reveal-selfcheck.sh` → **PASS**, and `wing-probe-selfcheck.sh` → PASS (no regression from the seam)
- the product fence test (`deletion-tooling-not-product-surface.test.ts`) unchanged and green
- **14/14 mutations caught** — 11 TypeScript, 3 shell (the shell pair committed on a throwaway branch, because
  a dirty tree makes the harness skip the very half under test)
- independent adversarial review: the withdrawal itself is **fail-closed on every traced path**, the seams are
  unreachable from any env var / argv / shell path, the central `a666ad1`-predates-`a3ef479e` claim was
  independently re-verified against the locator source as it existed at that commit, and scope + sanitization
  are clean. Six findings, all in the coverage this commit set out to preserve, all closed below.

| # | mutation | caught by |
|---|---|---|
| D1 | flag silently restored to `true` | intent marker + both gates |
| D2 | evidence state re-confirmed under a false flag | state assertion |
| D3 | the unmeasured `role` smuggled back onto the record | no-role guard |
| D4 | `visibilityFiltered` doctored to `true` | withdrawn-observation equality |
| D5 | the two commits collapsed, so the capture appears to postdate the filter | commit-inequality assertion |
| D6 | the 삭제 spec quietly retuned while withdrawn | spec-unchanged guard |
| D7 | deletion gate hardcodes the calibration | gate source assertion |
| D8 | deletion `main()` starts injecting the seam | gate source assertion |
| D9 | manifest display CLI hardcodes the calibration | CLI source assertion |
| D10 | reconfirmation standard softened off a measured tag | reconfirmation assertion |
| D11 | the manifest CLI **entrypoint** injects `selectorsCalibrated: true` | entrypoint source assertion |
| S1 | selfcheck hardcodes `DEL_CALIBRATED=1` instead of deriving | `SELFCHECK FAIL`, exit 1 |
| S2 | the shipped constant made unreadable (`Boolean(0)`) | `SELFCHECK ABORT`, exit 3 |
| S3 | `WITHDRAWN` dropped from the dirty-tree skip list | output inspection — see below |

**S3 is recorded honestly as a weaker catch.** Run first on a clean tree it reported CAUGHT for the wrong
reason: the branch it mutates only executes on a *dirty* tree, and the exit code was 2 either way because of the
calibration skip. Re-run on a dirty tree, baseline names `WITHDRAWN` among 14 skipped cases and the mutant names
13 without it — a real difference, but one no exit code distinguishes. Same shape as the mis-aimed mutation in the
previous unit, and the same lesson: a mutation that reports green without executing the code under test is the
failure mode this whole workstream is about.

- independent review

### What review caught, and what it says about the seam

Every finding was in the coverage the seam was built to protect — the commit built the mechanism and then
under-used it:

1. **A fully vacuous test.** The manifest-leak case ran the CLI with no injection, so it asserted
   `expect("").not.toContain("wing.coupang.com")` — four assertions that cannot fail. Now injected, with an
   explicit `out.length > 0` so it can never silently go vacuous again.
2. **Pinned-scope coverage retired by an early `return`**, with a comment claiming it was "covered above". It was
   not: no other test checks that this CLI pins channel/account/surface/maxActions against a stale ambient env.
   Now injected. The withdrawal doc had listed "pinned scope" among what the seam preserved — that was wrong.
3. **The dirty-tree skip list omitted `WITHDRAWN`** (above).
4. **Asymmetric hardening.** The docstring claimed the entrypoint-passes-nothing half was asserted; only the
   env half was. `process.exit(runApprovalManifestCli({ selectorsCalibrated: forced }))` defeated every existing
   assertion and would have shipped a destructive manifest while withdrawn. The deletion CLI already had this
   guard; the display CLI now does too.
5. **Four stale in-code claims** that 삭제 is live-calibrated — two of them in the destructive gate's own module,
   one directly above the line this commit edited. Corrected. A comment asserting the opposite of what ships is
   the exact failure this unit exists to close.
6. Dormant PREPARED-shape branches; the CLI-only fields (`entrypointCommandId`, host category) now have an
   always-injected case.

**One gap remains open.** The selfcheck's *own* accounting is not under automated test: deleting its
`PARTIAL`/exit-2 block would make a skipped run print green, and nothing would catch it. Same property as the
reveal harness, and a genuine meta-gap rather than a deferral with a rationale.

## Still open

A **live READ-ONLY delete probe** is the only thing that can restore the flag: a visible unique match with a
measured tag, against the unchanged spec. It is not scheduled, and this document does not authorize it.

Not addressed: `wing-probe-selfcheck.sh` still prints `SELFCHECK PASS` with exit 0 while skipping its clean-tree
half on a dirty tree. It is now the only WING harness that does — reveal closed it two units ago, deletion closes
it here.

## Next

`Coupang WING Issuance Form Reveal Live v2` — unrelated to this path, and unblocked by it.
