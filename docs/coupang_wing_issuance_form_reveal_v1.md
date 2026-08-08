# Coupang WING Issuance Form Reveal Driver v1

> **Status:** offline. Adds a dedicated phase/driver/CLI so the operator's first `발급` press is a **separately
> approvable operation** from key creation. No live run, no browser, no marketplace contact. The shipped 7-step
> guided tutorial and every FE stage identifier are **behaviourally unchanged** — only their falsified comments
> were corrected.

## The defect this closes

The shipped guided runtime models `발급` as the press that **creates the key**:

| evidence | what it says |
|---|---|
| `COUPANG_TARGET_BARRIER_STAGE.issue` | `checkpoint_before_issue`, docstring: *"presses 발급 themselves **to issue the key**"* |
| `TARGET_STEP` | `self_dev:2 → vendor_info:3 → call_ip:4 → issue:5 → credentials:6` |
| `coupang-issuance-stages.ts` | *"a fixed 7-step line: … 호출 IP → 발급 checkpoint → copy the keys"*, all *"SECTIONS on the one page"* |
| — | **no state** for "발급 pressed, form visible, no key yet"; **no target for `확인`** |

Live evidence falsifies the "one page" premise. On the real no-key open-API surface:

| target | result |
|---|---|
| `self_dev` | **0** for every candidate spelling (`자체개발`, `자체 개발`, `개발방식`) |
| `call_ip` | **0** for every candidate spelling (`호출 IP`, `호출IP`, `호출 ip`); `IP 주소` matched 2 |
| `vendor_info` | 8 / 4 / 0 across structural queries — never unique |
| `issue` | **1**, role `button` |
| `credentials` | **1**, role `readonly-region` |

The three form fields are not on that page. So under the guided runtime, an operator pressing 발급 would advance
from `checkpoint_before_issue` to `guiding_copy_keys` — **past a barrier nobody crossed, to copy keys that do not
exist.** Fail-open on the one step that mutates marketplace state.

## Why the fix is narrow

The "correct" flow (`발급` → Stage-2 → 자체개발 → 업체명 → URL → IP → `확인`) implies a 10-step plan and 3 new
stage identifiers. But `COUPANG_ISSUANCE_TOTAL_STEPS = 7` is the **shipped** plan, its stage names are a product
requirement the FE keys tutorial copy off, and the new ordering would be inferred **entirely from prose about a
screen nobody has observed**. Rebuilding it now would replace a wrong model with a guessed one.

So: this unit makes the two operations separately approvable and leaves the plan alone. The restructure happens
in the unit that has the real Stage-2 DOM.

## What landed

**`WING_ISSUE_SELECTOR_CALIBRATED`** — the `issue` locator is live-confirmed: `matchCount === 1`, role `button`,
on **four independent captures across BOTH account states** (already-issued 2026-08-06/07, real no-key
2026-08-08). A stronger basis than the single capture behind the 삭제 calibration.

Two things it deliberately does not do. It does **not** flip `WING_HIGHLIGHT_CALIBRATION` (the other three
targets are still unresolved). And `pressOutcome: "UNCONFIRMED"` — calibration covers the **locator**, never what
the press does. `signatureStability` is `CROSS_SESSION_VARIATION_OBSERVED`, which is stronger than the 삭제
evidence's "not established": four captures show the signature **moving** (`d3f775e8…` → `b7ba43a8…`) with no
signature-code change between them, so `signatureRole: "EVIDENCE_ONLY"` is a hard requirement, not a caution.

**`CoupangWingRevealDriver`** — on the audited deletion-driver shape: classify → probe → highlight → rest →
operator acts → clear → observe once → stop. It refuses a non-open-API page, refuses a non-unique `발급`, refuses
to highlight without the calibration, refuses the operator-action step without a **painted** checkpoint, and
clears the overlay **and the read-only tag** before observing (censusing our own panel would read SellerOps'
injected DOM as WING structure), and a clear it cannot verify makes the reading `OVERLAY_NOT_CLEARED` rather than a
confident verdict with a flag beside it.

On the source guard, precisely: it proves no obvious Playwright action API is called *in this file*. Review showed
a method evaluating an in-page `HTMLElement.prototype.click.call(...)` string would pass it. So the page-side
surface is bounded instead — a test asserts the driver evaluates **exactly three** scripts, all audited: the
fixed-label locate builder, the census, and the tag clear.

**The action is not key creation.** `REVEAL_WING_ISSUANCE_CONFIGURATION` vs `COMPLETE_WING_KEY_ISSUANCE` — and
the separation is enforced by the **typechecker**: both are literal types, so `tsc` rejects a comparison between
them as having no overlap. A future edit merging them fails to compile.

**`COUPANG_WING_ISSUANCE_FORM_REVEAL`** — its own phase, `allowsHighlight: true` (⇒ fails closed without the
calibration), agent `mode: READ_ONLY`, with an immutable `OperatorRevealAction` descriptor the gate enforces
field by field.

### The two claims the manifest must carry together

```
createsKeyMaterial : false   ← the operation being approved is not the key-creating one
keyCreationRuledOut: false   ← and this run cannot PROVE none was created
```

They look contradictory and are not; they are the two different things a reader needs. The second exists because
`wingIssuedStateFrom` returns `NO_DISCRIMINATING_SIGNAL`: every sanitized signal is identical between a real
issued page and a real no-key form — including `credentialAnchorPresent: true` and `credentials` matching 1 on
both. Collapsing them into one optimistic boolean is how a manifest comes to over-claim. The gate refuses every
softening of either, and `WingRevealOutcome` has **no** `NO_KEY_CREATED` member — a test asserts no outcome name
even pattern-matches `NO_KEY|NOT_ISSUED|SAFE|CLEAN`.

### Fail-closed on the expectation

The expected outcome is narrow on purpose: still on `open_api_issuance` **and** `submitAffordancePresent` flipped
false→true. `credential_shown` — the keys-displayed category — is **excluded** and has its own outcome
(`CREDENTIAL_SURFACE_APPEARED`, a STOP): review found it had been accepted as "still the open-API surface", so a
transition into the one category that most suggests a key was created came back as the benign expected result. That is the only delta the current census could plausibly show for "a form with a 확인 button
appeared" — the initial surface read `false` on every capture, while editable inputs and list containers were
already `many` and cannot rise. If the real Stage-2 does not flip it, the honest result is
`SURFACE_CHANGED_UNRECOGNIZED` (or `SURFACE_UNCHANGED`), which is a **STOP** and is itself the evidence the next
unit needs. Widening the predicate to make a live run "pass" would be the speculative retuning
`collector/CLAUDE.md` §6 forbids.

## Stage-2 candidates — hypotheses, inert

`WING_STAGE2_RECON_CANDIDATES` is declared and **read by no code path**. `URL`, `IP 주소` and `확인` are
transcribed from the product owner's description of the official Coupang flow, not invented here; `IP 주소`
matching 2 on the initial surface is weak corroboration that the phrase exists in WING's copy — a reason to
measure it, not to ship it. The initial-surface results are **not** transferable: they say those labels are absent
from *that* screen, not what Stage-2 contains.

## Corrected, not changed

`coupang-issuance-stages.ts` and `coupang-issuance-driver.ts` now carry ⚠ blocks stating that the 7-step plan is
contradicted by live evidence and is not safe to run, and that the "press 발급 to issue the key" claim was wrong.
Behaviour, stage names, step count and step plan are untouched.

## Verification

typecheck + full collector suite green. New tests: 39 (driver) + 21 (gate) + 12 (manifest phase) = **72**.

**Two coverage gaps were stated here rather than glossed** — the shell harness had no `*-selfcheck.sh`, and
`main()` was unexported, so the sentinel flow and the abort paths were unverified. Both are closed by
`docs/coupang_wing_reveal_live_harness_final_check_v1.md`. That unit changed no selector, stage structure, or
guided-tutorial step; it did change operator-visible CLI behaviour in three ways its own doc records (where the
completion sentinel is disclosed, a STOP block on every unexpected outcome, and an exit code that distinguishes
them).

## Not in this unit

No live run. No 자체개발 selection, no 업체명/URL/IP input, no 확인, no key issuance, no credential read, no
credential replacement, no connect-test, no sync. No FE tutorial restructure. `WING_HIGHLIGHT_LABELS` is
byte-identical.

## Next

`Coupang WING Issuance Form Reveal Live v1` — fresh bootstrap, fresh grant, the operator presses 발급, one
sanitized observation, STOP. **Only that evidence** may drive the guided step-plan redesign.
