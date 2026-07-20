# NAVER Review ID Reconciliation + Exact Row Locator — SCOPE CONTRACT

> **Written FIRST, before any code, as the drift guard for this milestone.** Anything not listed under
> §1 is out of scope. If the work appears to need something in §2, **stop and report** — do not absorb it.
>
> Status: **SCOPE LOCKED (2026-07-20)** · branch `feat/naver-review-id-reconciliation` off `origin/main` @ `b6a40b6`.
>
> **Outcome: ✅ MET (2026-07-20).** See [the run record](r4-review-id-reconciliation-run-record.md) and
> [D-036](decisions.md). E1–E6 below are marked with what actually happened; §5's honest-stop rule was
> exercised for real on the first run before the second one succeeded.

## 0. The problem this milestone exists to solve

Today the guided reply runtime can only find the live NAVER review row two ways, and **neither is an
identity match**:

- **Hint matching** — `(rating, recencyBucket, bodyFingerprint)` only. The reply target hint DTO deliberately
  carries *"NO product/author/channel-side id"*
  (`backend/.../attention/reply/dto/ReviewReplyTargetHintView.java`).
- **Operator calibration** — a human clicks the row and the runtime retains that live element in memory
  ([D-033](decisions.md)). Correct by construction *for that session only*, and it proves nothing about identity.

Meanwhile the imported NAVER review export **does** carry a channel-side review id, which lands in
`reviews.external_id` and is already the primary dedup key. The two halves have never been reconciled.

## 1. IN SCOPE

1. **Trace** the imported Excel review-id column into the canonical backend field, and prove it is carried
   **without transformation** (beyond header normalization and whitespace `strip()`).
2. **Discover, read-only,** whether that same identifier is exposed on the live NAVER review row. Inspection
   order is fixed and must be honoured:
   1. visible row data → 2. anchor `href` → 3. checkbox `value` / `data-*` attributes → 4. page state →
   5. the review-list network response.
   Each rung is attempted only if the previous rung yields no usable id.
3. **Prove equality** for exactly **one** supervised target review, with **no raw identifier printed, logged,
   or persisted**. Comparison happens in memory and/or over a one-way fingerprint; only redacted/hash-based
   evidence is reported.
4. **An exact locator** keyed by `(channel, sellerAccountId, channelReviewId)`.
5. **Exactly one match is required.** Zero matches and multiple matches both **fail closed** — no
   "best" match, no first-wins, no silent degradation.
6. **Secondary assertions after — never instead of — an ID match**, and only over non-identifying facts:
   rating, date/recency bucket, product reference *when available*.
7. **The existing operator-calibrated / fingerprint flow is retained only as an explicit fallback.** It must be
   labelled as a distinct, weaker match mode. It is **not** equivalent to an ID match and nothing in this
   milestone may imply it is.

### Live behaviour (non-negotiable)

The runtime may **inspect** and **highlight** the exact matched row. It must **never** click, navigate, type,
paste, open the composer, or submit. The operator is asked only for unavoidable NAVER login/filter actions and
visual confirmation.

## 2. OUT OF SCOPE — do not add, do not "while I'm here"

- Any reply **composer** work (locating, highlighting, opening, calibrating).
- Any **submission**, draft entry, paste, or outcome-recording change to the submission flow.
- Any **UI / frontend** change.
- Any **multi-channel** work (ESM+, Cafe24, Coupang). NAVER only.
- Broadening `[EXT]` **B1** cross-source robustness (`reply-cross-source.ts`) beyond this single target.
- Repointing or refactoring the existing hint/calibrated drivers beyond adding the fallback label.
- Any new **migration** or `reviews.seller_account_id` column (see §4).

## 3. EXIT CRITERIA

| # | Criterion | How it is evidenced | Outcome |
|---|---|---|---|
| E1 | Imported review id and live-row id proven equal for one real review | live run record: fingerprint equality, `matchMode=channel-review-id` | ✅ `idrun_b00209b6f66d` |
| E2 | The locator resolves **exactly one** row and highlights it | live run record: `matchCount=1`, highlight visually confirmed by the operator | ✅ `matchCount=1`, `outline=outlined`, `operatorConfirmed=true` |
| E3 | No raw account id, review id, review text, or approved draft in any log or report | guard test + manual sweep of the run output | ✅ plus a unit test over the record object itself |
| E4 | Deterministic tests cover exact match, zero match, duplicate match, malformed id, secondary-assertion mismatch | vitest, offline, no browser | ✅ all five, + context mismatch, rung precedence, hostile page shapes |
| E5 | One independent read-only review reports **no MEDIUM+ defect** | reviewer agent report | ⚠️→✅ 1 HIGH + 8 MEDIUM found, **all fixed and mutation-tested** before the live runs |
| E6 | Offline proof green | typecheck · full collector suite · browser rung · backend tests | ✅ 4089 passed / 61 skipped; backend BUILD SUCCESSFUL |

**A note on E5.** The first review pass found a HIGH defect that one of my own tests had asserted as correct
behaviour (rung-first search could return a match while two rows genuinely carried the identity). It is
recorded here rather than quietly fixed, because "the tests passed" was exactly the state in which that defect
existed.

**A note on E1/E2.** They were met on the **second** live run. The first returned `ZERO_MATCH` while the id was
simultaneously present in the network response — the review-number column had not rendered. The negative was
reported honestly rather than worked around, and the fix (rescan on operator view adjustment; widen to an
exclusive ancestor) kept the runtime read-only. See [D-036](decisions.md).

## 4. Constraints discovered before coding (repository-verified)

- **`reviews` has no `seller_account_id` column**, and that absence is documented as deliberate in several
  places (`ReviewTriage.java`, `ReviewReplyApproval.java`, `ReviewReplySubmissionRef.java`, …). Therefore the
  `sellerAccountId` component of the locator key is supplied by the **request bundle** the target was prepared
  under — it is **not** read from the reviews table, and **no migration is added**.

  **Honest limit, corrected after review (2026-07-20).** An earlier draft of this section claimed the key
  "fails closed if the runtime context does not match". In this flow it cannot: the probe builds the key and
  the comparison context from the *same* bundle field, and it never reads back which seller account the open
  browser profile is actually logged into. `CONTEXT_MISMATCH` is therefore a real guard for *other* callers
  but a tautology here. The run record says so in a dedicated field
  (`sellerAccountBinding: "asserted-by-request-bundle-not-verified-against-session"`), and **the milestone
  claims REVIEW identity only — never that the live session belongs to that seller account.** Verifying the
  session's account against the connection registry is a separate, deliberately deferred piece of work.
- **The reply target hint DTO deliberately excludes channel-side ids.** Carrying a **one-way fingerprint** of
  the review id (never the id itself) is the narrowest change that satisfies §1.3 without contradicting that
  contract; the DTO's own doc comment is updated to say so explicitly, and it is a **product-owner-authorised
  change from the dispatching turn** (conflict priority #1), not a silent reinterpretation.
- **No anchor-`href` reading exists anywhere in the reply-submission surface today** — every live reader is
  generic-structural by design. Rung 2 of the discovery ladder is therefore genuinely new code, and is
  read-only.

## 5. Honest-stop rule

**If the live surface exposes no usable matching identifier, the milestone stops there and reports the
inspected evidence, rung by rung.** It does **not** fall back silently to the calibrated flow, and it does
**not** describe fingerprint/hint matching as an ID match. A negative result is a valid, reportable outcome of
this milestone — the same way [D-035](decisions.md) recorded a negative navigation result.

## 6. Claim discipline

Nothing in this milestone may claim:

- an end-to-end reply **submission** (the reply terminal stays permanently `UNVERIFIED`, [D-032](decisions.md)(b));
- general **B1** cross-source fingerprint robustness;
- that the operator-calibrated fallback is **equivalent** to an ID match;
- multi-review or multi-account generality from a single supervised target.
