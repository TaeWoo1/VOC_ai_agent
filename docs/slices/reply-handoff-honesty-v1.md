# Slice — Reply Handoff Honesty v1

> **Status:** IMPLEMENTED, offline. **Consumes no gate, promotes no capability.** §4.1 and
> `docs/channel_capability_ledger.md` untouched. Collector untouched. **Migration V24** relaxes one
> NOT NULL; no data is rewritten.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (the handoff at the end of it)
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why — production was minting Action Window runs that never happened

The journey audit's last stretch (detail → draft → approval → Action Window) found the ACT stage
claiming more than it did.

`VocItemReplyPrep` defaulted its runtime to `createSimulatedReplyRuntime()` at module scope.
`createBridgeReplyRuntime` — the real one — is referenced by nothing but its own definition and its
unit tests. So **every shipped build** ran the simulation: it minted a `run_<hex>` locally,
synthesised a contract-valid terminal event, and the FE persisted that runId into
`review_reply_outcome.aw_run_ref`.

The column was `not null`, so this was not laziness — it was **forced**. A client with no runtime had
to supply something, and the only thing available was a fabrication. The result: a table of Action
Window run identities in which a real guided run and an invented one are indistinguishable.

Meanwhile the button said **가이드** (guide) while nothing opened the seller center, nothing located
the review, and nothing observed the post. The panel's body copy was already honest ("SellerOps가
대신 하지 않으며, 답변 여부도 확인하지 않습니다") — the label and the run record were not.

## 2. What changed

**No silent simulation in shipped builds.** The module-level default is gone.
`resolveReplyRuntime()` returns the simulated runtime **only** under `isFixturePreviewEnabled()`
(`import.meta.env.DEV`), so the production bundle tree-shakes the branch out and resolves `null`.

**Null is a capability statement, not an error.** The panel branches on it into a **manual handoff**:
different button copy (직접 답변하고 기록하기, not 가이드), an explicit line that this screen does not
guide, and an outcome recorded with **no run ref at all**.

**The database can now say "no run".** V24 drops `NOT NULL` from `aw_run_ref`; NULL means exactly
"no Action Window run backed this report". `ReviewReplyService.requireAwRunRef` — the guard that
*forced* the fabrication — became `optionalAwRunRef`, normalising blank to null so a caller with no
run says so by omission rather than by inventing a placeholder.

**Locating context, because nothing navigates for the seller.** The prep view gains `productName`,
`reviewDate` and `rating` — exactly the coarse narrowing its own fingerprint javadoc already
described as the fallback when an identity match is unavailable. They add no new exposure: all three
are already on the attention row the operator clicked through.

**One display-name rule, not two.** `OperatorProductName` extracts the rule that withholds a name
equal to its own SKU. The attention row and the reply panel now share it — two copies of a rule this
subtle drift apart silently, and the drifted surface keeps rendering, it just starts rendering a
`상품번호`.

## 3. What is pinned

| guarantee | test |
|---|---|
| production resolves no runtime | `returns NULL in a production build, so nothing can simulate a run` |
| DEV still simulates | `gives DEV builds the simulated runtime` |
| the manual path records **no** run ref | `without a runtime it offers a MANUAL handoff and records NO run ref` |
| the button does not promise guidance | same test — asserts no `/가이드/` button exists |
| the seller gets locating facts | `gives the seller what they need to FIND the review` |
| the server accepts an absent ref | `aManualPostRecordsWithNoRunRefRatherThanAFabricatedOne` |
| a blank ref is absence, not a value | `aBlankRunRefIsNormalisedToAbsentRatherThanStored` |

**Falsified, each caught:** restoring the silent production fallback broke 4; sending a fabricated
ref on the manual path broke the no-run-ref assertion; restoring `requireAwRunRef` broke both server
tests.

## 4. Verification

| | before | after |
|---|---|---|
| backend | 1500 (2 skipped) | **1502** (2 skipped) |
| frontend | 741 | **746** |
| collector | 4843 / 95 skipped | unchanged, untouched |

Both typechecks clean. **V24 verified on a disposable PostgreSQL 15 database** — applied as version
24, and `information_schema` confirms `aw_run_ref` is now `is_nullable = YES`. Database dropped; the
dev DB was never touched.

## 5. What the independent review caught

Three, all fixed:

1. **A dangling citation.** `IngestedReviewVocItemSource`'s class javadoc still cited
   `hasDisplayableName` — a method the extraction had removed from that class. Repointed at
   `OperatorProductName.displayNameOrNull`.
2. **An undocumented behaviour change.** The extracted rule returns the TRIMMED name where the
   predicate it replaced compared on trimmed values but returned the raw one. Nothing renders
   differently (both surfaces trim for display), but the DTO's contract now holds on the value itself
   rather than on what the client does to it — so it is written down rather than left to be noticed.
3. **A test-isolation defect, which then bit immediately.** The manual-handoff tests stub
   `import.meta.env.DEV = false`, and the stub was only cleared at the END of each test body — a
   thrown assertion would leak `DEV=false` into every later test, sending guided-path tests down the
   manual branch where they would pass while testing something else. Moving the cleanup into the
   nearest `afterEach` was **wrong**: that block lives inside the first `describe` and does not cover
   the others, so two guided tests started failing. Fixed properly at FILE scope. Worth recording
   because the failure was the good outcome — the alternative was two tests quietly asserting the
   wrong branch forever.

Also renamed `startGuided` → `startHandoff`: it opens the manual path too, and a name that
overclaims in code is the same defect as one that overclaims in a label.

## 6. Recorded, not fixed

- ⚠ **The real Bridge runtime is still not wired.** `createBridgeReplyRuntime` exists, speaks v2, and
  is unit-tested — but nothing constructs it from a live session. This slice makes the absence
  *honest*; it does not fill it. Auditing that wiring is the next step.
- `channelReviewIdFingerprint` remains unread by the frontend. It exists so a guided runtime can
  prove identity against the seller center — a consumer that still does not exist.
- **No link to NAVER.** There is no pinned review-list URL in the repo (`discover-reply-target.ts`
  reads `NAVER_REVIEW_URL` from the environment), and D-035 records that the detail-page navigation
  entry is not live-reachable. Establishing a destination needs live evidence, which is gated.
- **Run 7 stays deferred** until the approved network/IP environment returns. No gate consumed, no
  live contact.
