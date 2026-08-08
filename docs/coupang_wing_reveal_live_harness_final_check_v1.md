# Coupang WING Reveal Live Harness Final Check v1

> **Status:** offline. Closes the two coverage gaps the reveal unit stated about itself. No selector, stage
> identifier, guided-tutorial or FE change; no live run, no browser, no marketplace contact. Nothing pressed, no
> key issued. It **does** change operator-visible CLI behaviour — see "Behaviour that changed" below.

## What was untested, and why it mattered

`docs/coupang_wing_issuance_form_reveal_v1.md` shipped with both gaps named:

| gap | why it is the wrong thing to leave untested |
|---|---|
| the two new shell scripts had **no `*-selfcheck.sh`** | 250+ lines carrying the operator's entire disclosure surface — the text they grant against — verified once by hand |
| `main()` was **not exported** | every path deciding whether SellerOps touches a live page (both sentinel waits, both aborts, the timeout, three fail-closed refusals, the unexpected-outcome stop) was reachable only by opening Chrome on the seller's WING account |

Both are the same shape: the code that guards a real marketplace press was the code with the least coverage.

## Goal 1 — the reveal harness selfcheck

`wing-reveal-selfcheck.sh`, hermetic, reusing `wing-harness-common.sh` (one of its seven callers). It adds **no new checking
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

The preflight now reproduces the WING-page copy **complete**, and a TS test asserts the block **equals**
`WING_REVEAL_CHECKPOINT_LABEL`. Equality, not containment: the first version showed two of the label's five
sentences under a "verbatim" header — dropping the "not confirmed" hedge, the Korean statement of
`keyCreationRuledOut`, and "read the screen before you signal" — and a substring check can see neither an
omission nor a sentence added to the on-page panel that the preflight never shows.

## Goal 2 — reveal CLI testability

`runRevealWalk(driver, io, urlCategory)` and `waitForSignal(target, kind, abortPath, deps)` are exported and
dependency-injected. `main()` stays unexported and is now wiring only: launch, hand over, tear down.

Browser launch is blocked structurally, not by convention — the walk takes a **five-method driver interface**
with nothing that can navigate, click, type, or read a value, so a test never needs Playwright. A source guard
pins that the walk calls only those five methods (an allowlist; a forbidden-token denylist cannot see a method
that does not exist yet) and that `main()` re-implements no walk decision.

`waitForSignal` takes the signal's **kind** as a parameter rather than deriving it from the target path. Stated
plainly, because review corrected an earlier version of this paragraph that called it a strict improvement: the
original derivation was over a closed two-call-site set and **failed closed** under the mis-wiring that matters.
Decoupling the label from the file is what makes the walk testable, and it moved the risk rather than removing
it — so `makeRevealIo`, the one place the two are re-joined, is exported and tested directly, and a fired
sentinel is now consumed so the "both waits watch the ready file" mistake times out instead of skipping the
human checkpoint.

Tested directly: ready · completion · abort (file and SIGINT flag) · abort winning a same-tick race · timeout ·
tick budget · every refusal stopping before the next step · cleanup on **every** exit path including a thrown
observation · the checkpoint copy preceding the press wait · `credential_shown` reported loudly and never as
expected · a failed overlay clear passed through rather than rounded up.

## Behaviour that changed

Listing these because "closes a testability gap" is not a licence to move a live-run guard silently. Two are net
changes against `main`; the first is a **restoration**, and the last two are smaller notes that a later review
caught missing from this list.

1. **RESTORED, not changed: the completion sentinel is disclosed at the checkpoint.** `main` already printed it
   there. This branch's first commit moved it to startup, which invites the operator to create it early — and a
   pressed sentinel that already exists makes the checkpoint wait return on tick 0, skipping the human
   checkpoint in silence. It is back where it was, now as one combined line rather than two (the only net
   formatting change here).
2. **Every unexpected outcome gets a STOP block**, not just `CREDENTIAL_SURFACE_APPEARED`. Five of the six
   printed the same "observation complete" line a good run prints, while the docstring promised an unrecognized
   outcome "stops, never as success".
3. **The exit code distinguishes the outcome classes** — expected `0`, unexpected `6`, nothing observed `7`,
   failed overlay clear `8` (`revealExitCode`, tested by value). `main()` had discarded the report and exited 0
   whatever happened, which is how "the walk completed" comes to read as "the expected thing happened" to
   anything downstream of the terminal. **`8` supersedes `6` and `7`** — `cleanupFailed` is tested first, so a
   consumer keyed on "`6` = unexpected outcome" misses `CREDENTIAL_SURFACE_APPEARED` whenever the overlay clear
   also failed. Read `8` as "this run's state is not trustworthy AND something may be left on the live page".
4. **A failed overlay clear is now reported on every path.** `main` propagated a throwing clear on exactly ONE
   of six paths and swallowed it on the other five, so this is new rather than restored. It also required
   changing `cleanup()` to return a boolean: `clearHighlight` catches every error it can hit, so the production
   driver reports a stuck panel by RETURN VALUE and can never reject — the first version of this guarantee was
   wired to a rejection it could not produce, and only a fake could make its test go green.
5. **`driver.cleanup()` now runs twice on EVERY path** (the walk's `finally` and `main`'s) — the three
   fail-closed refusals and both aborts included, not only a completed walk. It is idempotent, so this is not a
   defect, but it is a change in how many times SellerOps touches the seller's live page. Relatedly, a throwing clear at the checkpoint-abort path used to emit `aw_coupang_reveal_run_fatal` and
   exit 1; it now exits 8 with the STOP line and no fatal log.

6. **Sentinel files are CONSUMED the moment they fire.** `main` never unlinked one mid-run; `makeRevealIo` now
   removes the ready file and the pressed file as each is observed. Operator-visible — the file they created
   disappears — and load-bearing: it is what makes a "both waits watch the same path" mistake time out instead
   of skipping the human checkpoint.

Two fail-open shapes were fixed alongside them — **both introduced by this branch, neither present on `main`**
(`POLL_MS` was a hard constant with no injection point, and `urlCategory` was not a parameter at all), so they
are intra-branch regressions closed within the branch rather than changes against `main`: `waitForSignal` clamps
its poll interval (`pollMs: 0` made the
derived budget `Infinity` — a wait with no deadline; a negative one skipped the loop body entirely, returning
`timeout` without ever checking abort or the target), and `urlCategory` is typed as the enum rather than
`string`, under which passing the raw WING URL typechecked and printed it into the sanitized stdout record.

## Not in this unit

No live run, no WING window, no 발급 press, no Stage-2 recon, no selector change, no 7-step tutorial
restructure, no deletion/renewal change. `WING_HIGHLIGHT_LABELS`, the stage identifiers and the step plan are
byte-identical.

## Next

`Coupang WING Issuance Form Reveal Live v1` — fresh bootstrap, fresh grant, the operator presses 발급, one
sanitized observation, STOP. **Only that evidence** may drive the guided step-plan redesign.
