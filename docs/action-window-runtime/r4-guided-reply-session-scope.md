# NAVER Guided Review Reply Session v1 — SCOPE CONTRACT

> **Written FIRST, before any code, as the drift guard for this milestone.** Anything not listed under
> §1 is out of scope. If the work appears to need something in §2, **stop and report** — do not absorb it.
>
> Status: **SCOPE LOCKED (2026-07-20)** · **LIVE-PROVEN (2026-07-21)**, see §7 · branch
> `feat/naver-guided-reply-session-v1` off `origin/main` @ `b41749d`.
>
> **Reading-order warning.** §4.2c and §4.2d describe the SPA-state identity design, which a live
> diagnostic **falsified**. They are kept as the reasoning record, but they are **superseded by §4.2f** and
> do not describe what ships. Read §4.2f before either.

## 0. What this milestone is

The first **end-to-end operator workflow**: an approved SellerOps reply task is carried all the way to the
live NAVER composer, and stopped there. Every piece except the account preflight already exists and is
live-proven; this milestone is where they become one guided session.

Explicit product-owner framing from the dispatching turn: **session seller/store verification is not a
research slice.** It is implemented as the **mandatory preflight of the real workflow**, and nothing
downstream of it runs unless it passes.

The nine steps:

1. Start from an approved NAVER review task in SellerOps.
2. Launch the Action Window.
3. **Read-only verify the open NAVER seller/store session against the connection registry.**
4. If matched, guide the operator to render the review-number column.
5. Resolve the target with the proven `channelReviewId` exact locator — global cardinality 1 + outline
   re-verification ([D-036](decisions.md)).
6. Ask the operator to visually confirm the row.
7. Guide the operator into the inline composer.
8. Highlight the composer and display the approved draft in a read-only SellerOps overlay.
9. **Stop before typing, pasting, or submitting.**

## 1. IN SCOPE

1. **Session account verification as a blocking preflight.** Not a comparison of the internal
   `sellerAccountId` to page text. The runtime performs a **bounded read of two operator-calibrated
   seller-center chrome elements** (see §4.2f — parsed SPA state was tried and measured empty on this
   surface, and network responses were rejected outright); combines them into one composite; fingerprints
   it **in memory**; and compares it with the connection registry's stored
   channel-account fingerprint. It returns only `MATCH`,
   `MISMATCH`, `UNAVAILABLE`, or `NEEDS_BINDING`, plus a non-sensitive display name when available.
   **`MISMATCH` and `UNAVAILABLE` fail closed before review lookup.**
2. **The live boundary for the existing offline fingerprint chain.** `AccountSignalPageProbe` has always been
   documented as *"the seam a FUTURE live Playwright boundary will fill"*; today the only filler is
   operator-hand-supplied probe JSON (`cli/connection.ts`). This milestone fills it read-only, for real.
3. **A bounded, operator-confirmed first-time binding step.** When the registry holds no verifiable
   fingerprint for this account, the operator confirms the store visible in their own browser and only then
   is a fingerprint persisted. **Never a silent bind. Never display-name equality as the primary proof.**
4. **A deterministic link between the reply request bundle and the connection registry** (see §4.1) — so
   "which connection is this run about" is resolved by data, not asserted by the operator each run.
5. **Re-verification of the account at three barriers** — before the outline, before the composer step, and
   after the operator's own entry replaces the active page — on the same TOCTOU principle as
   [D-036](decisions.md)'s in-page fingerprint re-check.

   **What that does and does not catch, stated precisely (rewritten for §4.2f).** Identity is now read
   LIVE from the DOM at each barrier, so it is no longer a per-page-load constant — the earlier wording
   here described the deleted SPA-state mechanism and understated what ships. A client-side store switch
   that re-renders the chrome **is** caught, as are a logout, an off-seller-center navigation, a reload
   under a different store, a selector-source change, and a registry change. What still escapes the
   barriers is a switch that changes the store WITHOUT changing either calibrated chrome field, and the
   gap between barriers is not continuously monitored. **This milestone does not claim that every
   mid-session account switch fails closed** — only that the checks above do.
6. **Composer guidance + a read-only approved-draft overlay**, reusing the live-proven composer barrier
   ([D-034](decisions.md)) — highlight only, then a clean abort terminal.

### Live behaviour (non-negotiable)

The runtime may **inspect**, **guide**, and **highlight**. It must **never** click, navigate, type, paste,
open the composer, or submit. **The operator performs every NAVER action.** The existing
fingerprint/calibrated locator stays an explicit **fallback**, never described as equivalent to ID matching.

## 2. OUT OF SCOPE — do not add, do not "while I'm here"

- Any **submission**, draft entry, paste, or outcome-recording change. The abort terminal is the end.
- A **standalone seller-account research slice** — forbidden by the original dispatching turn.
  **Carve-out, granted explicitly by the product owner (2026-07-21):** a read-only
  `NAVER Store Identity Diagnostic` (`run-store-identity-diagnostic-live-naver.ts`) that discovers which
  identity keys the trusted page state exposes, binds nothing, and stops. This is not the research slice the
  original turn forbade — it exists *because* §4.2c refuses to let the runtime pick a store key, and the
  guided session cannot gather that evidence itself without also being able to bind. The CLI has no
  connection-store writer, no review locator, no composer and no backend client anywhere in its import
  graph, so "it cannot bind" is a property of the build, not a promise. E7 is unchanged and still requires
  the guided session.
- Any **frontend / UI** change. ("Launch the Action Window" is the existing CLI entry, not new UI.)
- Any **multi-channel** work. NAVER only.
- Broadening `[EXT]` **B1** cross-source robustness.
- Any **backend migration** or new backend column for store identity.
- Auto-selecting a store, or any change to the account/store chooser resolver.

## 3. EXIT CRITERIA

| # | Criterion | How it is evidenced |
|---|---|---|
| E1 | The SellerOps task launches the guided NAVER flow | one CLI carries bundle → preflight → locate → composer |
| E2 | The open NAVER session is proven to match the intended connection, or the flow fails closed | live run record: `session.verdict`, and no review lookup on a non-`MATCH`. **Scoped by §1.5.** |
| E3 | The target review resolves by exact channel review id to exactly one row | `matchMode=channel-review-id`, `matchCount=1`, **and `rowsTruncated=false, tokensTruncated=false`** — a hit on a truncated scan is one match among the rows READ, not global cardinality 1, and the run now refuses it rather than recording a cardinality it never established |
| E4 | The operator confirms the correct row | `operatorConfirmed=true` |
| E5 | Composer + draft overlay reached without entering or submitting text | terminal `COMPOSER_ABORT`, `reachedBarrier=true`. **`draftEntered=false` is pinned by the TYPE, not measured** — it is a restatement that no code path enters text, so the load-bearing evidence is the source guard (no `type`/`fill`/`press`/`click` in the reply-submission tree) plus the non-interactive overlay, not the field |
| E6 | Tests cover account match / mismatch / unavailable / first-time confirmed binding / review zero / review duplicate / account switch mid-session | vitest, offline, deterministic |
| E7 | One supervised live run reaches a clean composer-abort terminal | **MET 2026-07-21** — run `gsn_22be1695fa6f`, terminal `COMPOSER_ABORT`. (The pinned-store-key precondition in the original wording belonged to the superseded §4.2c and no longer applies; §4.2f requires calibrated selectors instead.) See §7 |
| E8 | One independent read-only review reports **no MEDIUM+ defect** | reviewer agent report, findings fixed **and mutation-tested** |
| E9 | No raw account id, store token, review id, review text, or approved draft in any log or record | guard test + a unit test over the record object itself |

## 4. Decisions taken before coding (repository-verified)

### 4.1 The registry↔account link — a real gap, closed deliberately

The reply request bundle carries `accountId` (the SellerOps backend seller-account UUID,
`reply-target-bundle.ts`). The connection registry is keyed by `connectionId` and stores
`boundStoreFingerprintHash` (`connection/types.ts`). **Nothing links the two today.** Verifying the session
without closing that gap would only move the operator assertion one step, so this milestone adds
`boundSellerAccountFingerprint` to the connection record (`schemaVersion` 1 → 2, records at version 1
migrate with the field `null`).

It stores a **fingerprint, not the raw UUID** — consistent with the module's standing invariant that the
store holds no raw identifier — under its own domain (`seller-account-binding/v1`) so a digest from this
contract can never be confused with a `review-id-fingerprint/v1` digest.

**Not over-claimed:** a UUID is not enumerable, so that digest genuinely conceals the account id. The
**store** fingerprint is a different matter — `fingerprintHash` is a bare SHA-256 and the token is now
`channelNo=<numeric id>`, an enumerable space. `connections.json` is leak *hygiene*, not concealment, and a
reader of that file could recover the store id by search. The store id is visible in the seller's own URL
bar, so the exposure is low — but "stores no raw identifier" should be read literally, not as privacy.

Resolution is by data: exactly one connection may carry the bundle account's fingerprint. **Zero →
`NEEDS_BINDING`. More than one → fail closed.**

**A pre-existing `commerce-id` binding is NOT compatible, and the mechanism matters.** A binding made through
the older `cli/connection.ts` flow hashes a bare operator-typed token (`12345`) where the guided runtime
hashes the self-describing token (`channelNo=12345`) — but that difference never surfaces as a mismatch,
because that CLI never writes `boundSellerAccountFingerprint` at all. The guided session finds no linked
connection, returns `no-connection-for-account`, and creates a **second** connection for the same store.
The registry is empty today, so none exists. If one ever does, it must be reconciled by hand.

**There is no unbind path.** `bindSessionAccount` refuses `already-bound`, and no CLI clears the binding, so
a binding written in error today is corrected only by editing `.connections/connections.json` directly. That
is a deliberate gap for v1 — an unbind command is a way to *lose* a verified binding — but it is a gap, not
an oversight.

**The version bump is one-way.** `toConnectionRecord` always stamps the current version, so the first
guided-session bind rewrites every record in `connections.json` as v2. A parser that only accepts v1 would
then reject the whole file. Nothing in this repository is such a parser — v1 is still accepted on read — but
an older collector build sharing the same store would be affected.

### 4.2 Verification must be category-aware, or it is wrong

`boundStoreFingerprintHash` is a digest of **one** token, and `fingerprintSourceCategory` records which
source produced it. Digesting a `store-url-path` token and comparing it to a `commerce-id` binding would
mismatch **every time** on a perfectly correct session. So re-verification extracts the candidate for the
**bound category specifically**:

- bound category absent this run → **`UNAVAILABLE`** (fail closed), *never* `MISMATCH`;
- present and equal → `MATCH`; present and different → `MISMATCH`.

`extractAccountFingerprint`'s existing precedence + ambiguity rules are used **only** for the first-time
binding, where an ambiguous seller context is already a conservative non-bind.

### 4.2b Corrections forced by the independent review (2026-07-20)

The first review pass found **3 HIGH + 2 MEDIUM**. All are fixed and mutation-tested; three changed the
design, not just the code, and are recorded here rather than quietly patched.

- **There is no URL-path identity source.** The original design fell back to `location.pathname` when no
  allow-listed key appeared. A seller center's path is the **same for every store the operator owns**, so
  binding it would produce a fingerprint that matches *every* store — a permanent, silent false `MATCH`, and
  one a mid-session store switch would sail straight through because the path never changes. A missing key
  fails **closed**; a store-agnostic path fails **open**. That asymmetry is the whole argument: a source
  whose failure mode is a false match must not exist until it is proven to discriminate.
- **The binding step gates on the session, not only on the operator.** `NEEDS_BINDING` is returned *before*
  the logged-in / seller-shell checks (there is no binding to check yet), so the bind path was the one hole
  in "an unconfirmed seller shell fails closed". A binding is permanent — an operator confirming from memory
  while the browser sat on a login page or a store chooser would have poisoned the registry for every future
  run. Confirmation is necessary, **not sufficient**.
- **Evidence caps count DISTINCT pairs, and overflowing one is fatal.** Capping the raw hit list before
  detecting conflicts meant a second store's identity arriving late was sliced away — turning a **conflict**
  into a confident answer. Repetition is now free; overflow now refuses.

The drift check also gained teeth: it compares the **live key each read used**, not only the stored
category, which is near-constant within a run.

### 4.2c ~~The network scanner is gone — identity comes only from parsed page state~~ — SUPERSEDED by §4.2f

> **SUPERSEDED (2026-07-21).** The SPA-state identity hypothesis this section builds was tested live and
> **returned a negative**: the seller-center review surface exposes **zero** state roots. The reasoning
> below is still why the network scanner is gone — that deletion stands — but *"identity comes from parsed
> page state"* is **no longer true of the shipping runtime**, and the `SELLEROPS_NAVER_STORE_KEY`
> pinned-key rule it introduces is **not** what gates the live flow. See §4.2f.


Four review passes ran. The first three each found that a fix had been applied at the named line while the
same failure class survived one layer upstream. The fourth found the shared root cause, and it was
design-level rather than a bug: **scanned response text has no provenance.** A regex over a raw body has no
idea whether a match sits at a real JSON key position, which origin served it, which page or tab it belongs
to, or when it arrived. Three separate false-`MATCH` paths followed from that one gap:

- **customer-written review text.** The review-list response is the one body this milestone is guaranteed
  to scan, and it carries review bodies. A review containing `{"channelNo": "999999"}` — plain or escaped —
  became the store identity. Verified against the real code, not hypothesised.
- **build-time bundle constants.** `{"channelId":"default"}` in a shared SPA bundle is byte-identical for
  every store the operator owns: a store-agnostic token, which is exactly the fail-open shape §4.2b deleted
  the url-path source for.
- **cross-tab, cross-time evidence.** The observer was context-wide and never reset, so a bound store open
  in a background tab could satisfy the preflight while the operator worked in a different store — passing
  every barrier, because the evidence never changed.

**So the passive network observer was removed entirely.** The in-page probe is immune to two of the three
by construction: review text is a string *value*, never a key position, and cross-tab evidence cannot reach
a probe that reads one page at one moment.

**It is NOT immune to the third, and a fifth pass caught the scope doc claiming otherwise.** A build-time
constant such as `{"channelId":"default"}` sits at a real key position on the current page and passes every
shape check — and it is byte-identical across every store the operator owns. So the milestone adds the rule
that closes it: **no key may carry identity until it has been shown to DISCRIMINATE between stores**, and a
single run cannot show that. The runtime therefore refuses to pick one. Exactly one key, pinned by the
product owner in `SELLEROPS_NAVER_STORE_KEY`, is eligible; with none pinned the preflight reports which keys
the surface exposes, binds nothing, and stops.

**That makes the first live run diagnostic by design**, which is the honest shape for a key list the code
itself annotates `[EXTERNAL-RESEARCH — NOT REPOSITORY-VERIFIED]`.

**The honest cost, stated plainly.** [D-036]'s lesson — *not rendered is not not-exposed* — was the original
argument for scanning the network. If a NAVER store id is served **only** in a response payload and never
appears in SPA state, this milestone will now report `UNAVAILABLE` and stop. That is the correct failure:
a stop is recoverable and diagnosable, a false `MATCH` is neither. The run record reports `rootsWalked` and
`keysPresent` so the next decision is made on evidence rather than on a guess.

**Known limit, recorded rather than papered over:** identity is read from five SPA state roots
(`__PRELOADED_STATE__`, `__NEXT_DATA__`, `__NUXT__`, `__INITIAL_STATE__`, `__APOLLO_STATE__`) and inline
JSON script tags. A store id held only in component-local state, in a closure, or in a non-JSON payload is
not visible to it.

### 4.2d No safety gate may rest on text an attacker can write — rule stands, item 3's mechanism SUPERSEDED

> **Partly superseded (2026-07-21).** The *rule* in this section is this milestone's central invariant and
> still holds. But item 3's mechanism — `sellerShellSignal` = *"the page exposes SPA state roots"* — was
> falsified by the same diagnostic, and shipping it unchanged is exactly what made the **first live guided
> run fail closed** (§7.2). What `sellerShellSignal` means now is defined in §4.2f, and it is honestly
> *weaker*.


The session gates (`loggedInSignal`, `sellerShellSignal`) went through three forms, and the first two were
both unsound in the same way.

1. **Whole-document marker scan** (the shared `extractProbeSignals`). It reads the entire page HTML, which on
   a review list includes customer-written review bodies. A review containing `인증번호` or `2단계` flipped
   the verdict to `AUTH_CHALLENGE_REQUIRED` and stopped **every** run on that page — reported, misleadingly,
   as "not logged in".
2. **Chrome-scoped marker scan.** Narrow enough to exclude row containers, it missed real seller headers;
   wide enough to catch them (`[class*="header"]`), it swept per-row card headers, so a review body could
   supply the very word the gate looked for. That direction is **fail-OPEN** on the gate that guards a
   *permanent* binding, and fail-closed — an undiagnosable run-killer — in the other.
3. **What ships:** no text matching at all. `loggedInSignal` is the URL category; `sellerShellSignal` is
   whether the page exposes SPA state roots. A review body can change neither.

**The cost, stated:** the chooser detector is gone with the text scan, so binding safety now rests on the
operator's explicit confirmation, the pinned-key rule, and refusal on any conflicting evidence. A weaker
signal that an attacker can write is not a safer one.

**Diagnosability:** those fields (`stateRootsWalked`, `requestedKey`, `pinnedKey`, `keysPresent`,
`keysConflicting`, `probeTruncated`) live on the **store-identity diagnostic** record, NOT on the guided run
record — a reviewer pass found this paragraph attributing them to the wrong artifact. The guided record
carries `verdict`, `reason`, the two selector indices, `reverifiedAtBarriers` and `driftReason`; since
§4.2f it also distinguishes a contradicted identity (`ACCOUNT_DRIFTED`) from an unreadable one
(`ACCOUNT_UNVERIFIABLE`).

**What `sellerShellSignal` actually proves, precisely:** that the probe ran and the page carried at least one
parseable JSON blob. Not that the session is authenticated — an SEO `ld+json` tag alone satisfies it. That
weakness is accepted knowingly: every stronger signal available was text an attacker could write. The real
protection is that identity must be **present** and must **digest-equal** the binding, and a login page
yields neither.

**Expect to narrow the allow-list after the diagnostic run.** Any conflicting allow-listed key refuses the
whole read, and the list is an unverified hypothesis containing keys that could plausibly vary per review
row (`accountNo`, `storeId`, `sellerNo`). One noisy per-row key would stop every run regardless of what is
pinned — fail-closed and visible in `keysConflicting`, but a likely first-run outcome to act on.

### 4.2e How this property is enforced, after eleven review passes

The property is: **no attacker-influenced value reaches a session gate, a verdict, a terminal, or a
binding.** It took five attempts to state it in a form that survives review, and the failures are worth
recording because they were all the same mistake in different clothes.

1. **Forbidden names** (`not.toContain("chromeLogoutPresent")`) — defeated by renaming.
2. **Pinned expressions** (`toMatch(/const sellerShellSignal = …/)`) — defeated by a dead `const`, by a
   spread override downstream, and by reading page text through an API the blacklist had not named.
3. **Value-flow pins** (one producer, one call, no spread) — defeated by MUTATING the produced object:
   `Object.assign(signals, {loggedInSignal: true})`, one line, whole suite green.
4. **Frozen inputs** — defeated by rewriting the verifier's OUTPUT
   (`{ ...base, verdict: "MATCH" }`), one level downstream of every guard.
5. **What holds now**, and why each part is load-bearing:
   - `sessionSignalsFrom(url, chromeIdentityReadable, chosen)` takes a **boolean**, not the probe. (It took
     a *count* when this was written; §4.2f replaced the count, and the property is unchanged because
     neither a count nor a boolean can carry text.) Page text has no representation in its parameters, so
     it cannot reach a gate even by a one-line edit inside the module.
   - The signals object, the **verdict**, the probe result and its **hit entries** are all `Object.freeze`d.
     Reopening a gate or rewriting an answer now throws at runtime, with no test needing to have
     anticipated the spelling.
   - The guard **enumerates the directory** rather than a hand-kept file list — a filename pattern is not a
     boundary, and the milestone's most safety-critical module was itself missing from that list when a
     reviewer looked.
   - `session-signals.ts`'s **imports** are allow-listed, so the mutable singleton cannot simply move to a
     module with a different name.

**The general rule, which is the transferable part:** a guard that names what is forbidden protects nothing,
because the next author does not know the list. A guard has to make the unsafe thing *unrepresentable* — in
a signature, in a frozen object, in an enumeration — or it is documentation with a green tick.

### 4.2f What actually ships: a bounded seller-center CHROME identity

**The SPA-state hypothesis was falsified by measurement, not by argument.** The read-only Store Identity
Diagnostic (§2's carve-out) ran live on 2026-07-21 against the seller-center review surface and returned
`rootLabels: []` — **zero** state roots, untruncated. Every allow-listed key in §4.2c was absent because the
place §4.2c looked does not exist on this surface. That is an honest negative and it is why §4.2c/§4.2d are
marked superseded rather than quietly edited: the reasoning in them is sound and still worth reading, but it
describes a design that could not run.

**The replacement.** Identity is `(normalizedUserId, normalizedShopName)` — the visible NAVER user id from
the fixed account/header chrome and the current shop name from the fixed shop/sidebar chrome — joined by
U+001F and domain-separated SHA-256 into ONE composite. Neither half is usable alone, and that is a product
fact, not a stylistic choice: the user id matches every shop the seller owns, and a shop name is not unique
across sellers.

**This milestone deleted three text-derived sources and then read page text again. The distinction that
makes that legitimate** is between a *search* and a *bounded read*. A search finds every copy of a value,
including one a customer wrote in a review; a bounded read of one pinned container cannot reach a node the
customer chose. Four bounds enforce it, and the first is the load-bearing one:

1. the selector must resolve to **exactly one** element (not "the first match");
2. that element must neither sit inside nor contain a content region
   (`table, [role="table"], [role="grid"], [role="row"], [role="listitem"], article, tbody, tr`);
3. its text is bounded at `MAX_CHROME_TEXT = 200`;
4. it must pass the field's own shape check.

**Selectors are operator-calibrated, never guessed.** A separate read-only discovery CLI has the operator
click the two elements; the clicks are cancelled in the capture phase; selectors are derived by walking UP
from the retained element, never by searching for its text. Only specifications are stored — and, after
review, a **Node-side** guard rejects any candidate embedding either observed value. The in-page guard that
preceded it asked the containment question backwards (*"does the attribute contain the element's entire
rendered text"*), which never fires once the chrome decorates the value, so an `aria-label` holding the bare
account name was being persisted and printed.

**What `sellerShellSignal` means now, precisely, because the doc previously overstated it.** It is
`chromeIdentityReadable` — *both calibrated chrome fields resolved*. It is **NOT** an independent SPA-shell
proof, and it is honestly weaker than the signal it replaced claimed to be: it is close to restating "the
identity was readable". Shipping the old definition unchanged is what made the **first live guided run fail
closed** at `seller-shell-unconfirmed` (§7.2). The real protection remains what it always was — the identity
must be **present** and must **digest-equal** the binding — not this gate.

**Two collision checks, at two layers, because one is not enough.** `specsCollide` compares selector
*strings*; two different strings can resolve to the same element, which a location check cannot see. So
`normalizeSessionIdentity` additionally refuses a pair whose halves are **equal**. Without it, an operator
whose shop-name click lands on the adjacent header account chip binds a composite of one value with itself:
permanently MATCHing, identifying nothing, and recording the **user id** as `boundShopDisplayName` — the one
field this milestone prints and treats as non-sensitive.

**A MISMATCH ends the run; there is no inline rebind** (product owner, 2026-07-21). The runtime cannot
distinguish a renamed shop from a different seller — the composite is one-way and no user id is stored, so
both produce byte-identical evidence. Asking the operator to certify that mid-reply, one click away from a
permanent write with no unbind path, is the wrong place for the question. Rebinding belongs to a deliberate
connection-management flow.

### 4.3 The display name is a label, never a proof

The non-sensitive display name is the registry's `userProvidedDisplayName` — **typed by the operator, never
scraped from NAVER**. It is shown so the operator knows which connection they are confirming. It is never
compared, and never treated as evidence of identity.

### 4.4 The overlay mutates the page, and that is bounded

Highlighting already mutates the DOM (an outline + a marker attribute, restored on teardown). The draft
overlay is a larger mutation and is bounded the same way: **non-interactive** (no input, no editable
element, no form), appended at the document level rather than inside NAVER's composer, and torn down so the
DOM is left byte-identical. **The draft text exists only in memory and in the pixels; it is never logged,
never persisted to a run record, and never written into any NAVER field.**

## 5. Honest-stop rule

Each barrier is allowed to be the end of the run, reported as-is:

- no verifiable account identity on the live surface → stop at the preflight with the sanitized evidence;
- account mismatch → stop, and do not look up the review;
- zero or multiple review matches → stop (`ZERO_MATCH` / `MULTIPLE_MATCH`);
- composer not reachable read-only → stop at the row.

A stop is a valid outcome. Falling back silently, guessing an identity, or describing a weaker match as an
ID match is not.

## 6. Claim discipline

Nothing in this milestone may claim:

- an end-to-end reply **submission** (the reply terminal stays permanently `UNVERIFIED`, [D-032](decisions.md)(b));
- general **B1** cross-source fingerprint robustness;
- that the operator-calibrated fallback is **equivalent** to an ID match;
- multi-review, multi-account, or multi-channel generality from a single supervised target;
- that a `MATCH` proves anything beyond *"the store identity visible in this session digests to the value
  bound to this connection"* — it is not an authentication, and it is only as strong as the token NAVER
  exposes.

## 7. The live proof (2026-07-21)

### 7.1 What was proven — the exact claims, and no others

Supervised live run `gsn_22be1695fa6f` against the operator's own NAVER seller centre. **These eight
statements are the complete set of claims this milestone makes about the live run.** Anything not on this
list was not proven, including by implication.

1. A **first-time composite seller-session binding** was created and **verified against the open NAVER
   session** — not asserted from a request bundle. (`boundThisRun: true`, then `MATCH (ok)` re-read through
   the same path a later run takes.)
2. Identity was **re-verified at three barriers** — before the outline, before the composer step, and after
   the operator's own entry replaced the page — **with no observed drift**
   (`reverifiedAtBarriers: 3`, `driftReason: null`).
3. The target review resolved by **exact channel review id to one row of an untruncated scan**
   (`matchMode: channel-review-id`, `matchCount: 1`, `candidateRowCount: 13`, `scanCount: 1`,
   `rowsTruncated: false`, `tokensTruncated: false`).
4. The operator **confirmed the outlined row**, then reached the **inline composer**
   (`operatorConfirmed: true`, `entryTransition: INLINE_COMPOSER`, `reachedBarrier: true`).
5. The **approved draft was displayed read-only** (`draftDisplayed: true`).
6. **No typing, paste, submission, or runtime NAVER action occurred.** Every NAVER action was the
   operator's; the runtime inspected, guided, and highlighted.
7. Terminal: **`SUBMISSION_ABORTED` / `UNVERIFIED`**, recorded as `COMPOSER_ABORT`.
8. **Seller-shell confirmation rests on both calibrated chrome fields resolving — it is NOT an independent
   SPA-shell proof.** See §4.2f.

**Scope limits carried forward.** One review, one account, one channel, one operator, one surface. §6 still
governs: no submission is claimed, and `MATCH` remains a digest comparison rather than an authentication.

### 7.2 The first attempt failed closed, and that is part of the record

An earlier run, `gsn_fe5d1b15d5b0`, stopped at `ACCOUNT_BINDING_REFUSED` / `seller-shell-unconfirmed` with
`boundThisRun: false`. The cause was shipping §4.2d's definition of `sellerShellSignal` (SPA state roots)
after the diagnostic had already **measured** zero state roots on this surface — a predicted failure that
was not acted on. Nothing was bound. The record is kept rather than deleted: a fail-closed stop on a
permanent-write path is the system behaving correctly, and the run that produced it is the evidence.

### 7.3 What the record deliberately does not contain

No raw user id, seller account id, channel review id, review body, approved draft, URL, or digest. The
**shop display name is present by explicit decision** (§4.3) — it is the shop's own public name and it is
what makes a rename legible to the operator. The persisted selector specs likewise contain no identity
value; a Node-side guard now enforces that across both fields (§4.2f).
