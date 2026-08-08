# Coupang WING Reveal Live Harness Final Check v1

> **Status:** offline. Closes the two coverage gaps the reveal unit stated about itself. No product flow,
> selector, stage identifier, or FE tutorial changes; no live run, no browser, no marketplace contact. Nothing
> pressed, no key issued.

## What was untested, and why it mattered

`docs/coupang_wing_issuance_form_reveal_v1.md` shipped with both gaps named:

| gap | why it is the wrong thing to leave untested |
|---|---|
| the two new shell scripts had **no `*-selfcheck.sh`** | 250+ lines carrying the operator's entire disclosure surface — the text they grant against — verified once by hand |
| `main()` was **not exported** | every path deciding whether SellerOps touches a live page (both sentinel waits, both aborts, the timeout, four refusals, the unexpected-outcome stop) was reachable only by opening Chrome on the seller's WING account |

Both are the same shape: the code that guards a real marketplace press was the code with the least coverage.

## Goal 1 — the reveal harness selfcheck

`wing-reveal-selfcheck.sh`, hermetic, the third caller of `wing-harness-common.sh`. It adds **no new checking
logic** — every assertion runs the real preflight, or the real shared verifier, against fixtures.

Cases: no run env · unbound identity · stale identity (the 1h TTL, not the probe's) · malformed epoch · ambient
stamp · four wrong phases · HEAD drift · dirty tree · `GIT_DIR` hijack · out-of-repo collector · unreadable
`git status` · the descriptor matrix · NORMAL · no-leak · the default temp path twice.

**The descriptor check had to move to be testable at all.** The gate makes a softened descriptor unproducible
through the CLI, so inline in the preflight it was unfalsifiable — no end-to-end case could tell "checked and
refused" from "checked and ignored". It is now `verify_reveal_descriptor` in the shared harness, called against
crafted manifests: every safety-overstating softening, a descriptor re-pointed at `COMPLETE_WING_KEY_ISSUANCE`,
one re-pointed at `DELETE_WING_OPEN_API_KEY`, the destructive shape, and an absent descriptor are all refused.
The two verifiers are also checked against **each other** — neither harness may accept the other's contract.

The `keyCreationRuledOut: true` fixture is the one that matters most. It would tell an operator SellerOps had
confirmed no key was created, which nothing can.

### Two real defects the selfcheck surfaced

Writing the cases found them; neither was visible from reading the PASS path.

1. **The reveal bootstrap minted an identity on a dirty tree.** The destructive bootstrap refuses; this one only
   checked that HEAD was readable. Pinning a SHA that already does not describe the tree defers a guaranteed
   refusal behind a run env that looks valid.
2. **It carried a private, weaker `git_hardened`.** It *unset* the git config-file variables instead of pinning
   them to `/dev/null` — so a prepared `HOME` re-opens the `core.excludesFile` hole — and had none of the `-c`
   flags (`status.showUntrackedFiles`, `core.excludesFile`, `safe.directory`). A drifting second copy of that
   hardening is exactly what `wing-harness-common.sh` exists to prevent, and `repo-identity.test.ts` only
   mirrors the shared one. Both now come from the shared harness, asserted by a test.

### The Korean imperative reaches the operator before they grant

The preflight now quotes the WING-page copy verbatim, and a TS test asserts each fragment is a **substring of
`WING_REVEAL_CHECKPOINT_LABEL`** — so a reworded label cannot leave the preflight promising a sentence nobody
will see.

## Goal 2 — reveal CLI testability

`runRevealWalk(driver, io, urlCategory)` and `waitForSignal(target, kind, abortPath, deps)` are exported and
dependency-injected. `main()` stays unexported and is now wiring only: launch, hand over, tear down.

Browser launch is blocked structurally, not by convention — the walk takes a **five-method driver interface**
with nothing that can navigate, click, type, or read a value, so a test never needs Playwright and a future
edit cannot quietly widen it. A source guard pins that `main()` does not re-implement any walk decision.

One shape change worth naming: `waitForSignal` takes the signal's **kind** as a parameter. The original inferred
it by comparing the target path to `readyPath` — under which any path that is not the ready path reports as a
completed press.

Tested directly: ready · completion · abort (file and SIGINT flag) · abort winning a same-tick race · timeout ·
tick budget · every refusal stopping before the next step · cleanup on **every** exit path including a thrown
observation · the checkpoint copy preceding the press wait · `credential_shown` reported loudly and never as
expected · a failed overlay clear passed through rather than rounded up.

`CREDENTIAL_SURFACE_APPEARED` now gets an explicit stderr STOP block in Korean and English. It was already a
stop — the walk observes once and returns whatever happens — but the operator had to notice an enum inside the
JSON to learn the keys-displayed surface had appeared.

## Not in this unit

No live run, no WING window, no 발급 press, no Stage-2 recon, no selector change, no 7-step tutorial
restructure, no deletion/renewal change. `WING_HIGHLIGHT_LABELS`, the stage identifiers and the step plan are
byte-identical.

## Next

`Coupang WING Issuance Form Reveal Live v1` — fresh bootstrap, fresh grant, the operator presses 발급, one
sanitized observation, STOP. **Only that evidence** may drive the guided step-plan redesign.
