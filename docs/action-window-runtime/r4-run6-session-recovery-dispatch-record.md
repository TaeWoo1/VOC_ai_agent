# Run 6 — session recovery dispatch record (NOT AUTHORIZED · grants nothing)

> **This file authorizes no live NAVER contact.** It is the choreography and evidence sheet for a run that
> must be authorized elsewhere: a **fresh, scope-matched G3** and a **fresh, single-use, Run-6-scoped G6**
> recorded in the dispatching turn ([`r4-gate-record.md`](r4-gate-record.md)). **Every G6 to date is
> CONSUMED.** **The boundary** is [`r4-preparation.md`](r4-preparation.md) §4/§7 — binding, and it wins
> over this file.

**Status:** ☐ **DRAFT — NOT DISPATCHED, NOT AUTHORIZED** (2026-07-17). **No live gate below has been
affirmed** — G3 ☐, G6 ☐, P6 ☐, §7 ☐, seated-and-ready ☐. The one ☑ on this sheet is **G4**, ratified
2026-07-17 on §8-22 (below); **G4 is not a live gate — G3 and G6 are, and both are open.**

⚠ **UPDATE 2026-07-17 — the decisions this draft NAMED are now RATIFIED ([D-030](decisions.md)), and it
still authorizes nothing.** The product owner ratified, in docs only: (1) a **fifth G3 scope,
`session recovery`**;
(2) a **Run-6 G6 template carrying a `max live window:` field**; (3) that **G4 carries for Run 6 on the
basis of §8-22**, with `page.content()` mid-navigation and `main()`'s `settleSpa` **preserved as named
live-first residual risks**. All three live in [`r4-gate-record.md`](r4-gate-record.md) — the one
canonical home; this record restates none of them.

⚠ **A ratified scope is not an affirmed gate; a template is not an approval.** **No G3 instance is
affirmed. No G6 is filled. P6 is unsigned. This run is NOT AUTHORIZED.** The prerequisites now being in
place is exactly when they are easiest to mistake for permission — **the sheet being complete is not the
sheet being signed.** **Nothing here being written, read, or approved authorizes a run.**

## 1. Why this run exists

**Milestone A made a live login failure survivable, and none of it has ever met NAVER.** A2-B
([D-028](decisions.md), §8-20) made `LOGIN_REQUIRED`/`SESSION_EXPIRED` **park** rather than kill the run;
A3 ([D-029](decisions.md), §8-21) gave the CLI the loop that drives that park back into a live run — prompt
→ the seller logs in → they signal → the Runtime **re-probes for real** → the run continues. **The whole arc
is proven against fake drivers over an in-process loopback.** Passing tests say nothing about NAVER; the
operator gate is injected precisely so the loop can be tested without a browser.

Three questions, none answerable from code or docs:

1. **Does the CLI drive a real NAVER login park back into a live run?** Every piece is offline-green. The
   live path adds two interactions nothing tests: `settleSpa` on a real page, and a re-probe whose
   `page.content()` crosses a real navigation.
2. **D-028's falsifier — after the seller logs in, do they land on a readiness-`READY` export surface?**
   The driver **never navigates**, so a recheck probes whatever page login landed on. **Where NAVER lands a
   seller after login is UNOBSERVED.** `true` → the loop closes unaided. `false` → a navigate seam becomes a
   real product-owner question. This run harvests it for free, per attempt.
3. **`selectedRangePresent` in the positive direction** — free, *if* the seller selects a period/scope. Run 5
   produced one true negative; whether the detector can **ever** report `true` is untested live, and
   [D-025](decisions.md) named this its falsifier. ⚠ **Inventing a procedure for period/scope remains
   forbidden.**

## 2. Why it is non-mutating — by construction, not by lever

**Zero clicks.** The Runtime never performs the export action (§4 boundary), and this run's operator is
instructed to perform none either. **No click ⇒ no download ⇒ detect, validate and ingest are unreachable.**
Not "declined" — **unreachable**.

**This is strictly stronger than Run 5**, which clicked and relied on *not confirming* — a lever a tired
operator can slip. Run 6 removes the lever: there is nothing to slip.

⚠ **`--no-ingest` exists now ([D-027](decisions.md), A1) and this run does NOT use it.** It is **not a
safety flag** and is **strictly more mutating than not acting**: it still opens live NAVER, still needs a
real human action, and still lands a real file in quarantine. **Not acting remains the only lever that is
non-mutating by construction** — the one Run 3 and Run 5 used, and the one this run uses.

## 3. Dispatch checklist — ☐ NOT AFFIRMED (fill in the dispatching turn)

> **The G6 template lives in [`r4-gate-record.md`](r4-gate-record.md) and is deliberately NOT restated
> here** — one copy, one source. ⚠ **And for this run's scope, it does not exist yet** (§G6 below). This
> section records only what the dispatching turn must *affirm*. **Live begins only when the operator records
> a filled G6 in the turn that dispatches it.**

### Gate state — what carries, what does not

| Gate | Run 6 | Basis |
|---|---|---|
| **G1** channel ratified | ✅ **carries** | D-021 — NAVER SmartStore review export |
| **G2** seller consent | ✅ **carries** | Self-consent, `NAVER_DEV_SELLER_SELF_01`, D-024. §4 governs "any later, separately-approved" run |
| **G3** environment | ☐ **DOES NOT CARRY** | The scope now **exists** — `session recovery`, ratified 2026-07-17 as a fifth scope. **Existing is not affirming:** no instance of it has been recorded, and D-026 makes scopes non-substitutable. See below |
| **G4** synthetic ladder | ✅ **carries — RATIFIED for this run on §8-22, with two residuals named** | Not inherited from the static ✅. See below |
| **G5** policy track | ✅ **carries** | Logged; none required for a seller-owned export on the seller's own session |
| **G6** per-run | ☐ **fresh, single-use** | **Every G6 to date is CONSUMED.** A Run-6 template now exists in [`r4-gate-record.md`](r4-gate-record.md) — **blank; a template is not an approval** |
| **P6** | ☐ **not signed** | Signed only once G6 + the G3 affirmation + §7 all land in the dispatching turn |

### G4 — RATIFIED 2026-07-17 for this run, on §8-22 · the two residuals are the point

**Resolved by the product owner:** A4 delivered §6's 11th rung — **Session recovery (park → re-probe)**,
green over a **real browser on a synthetic DOM**, `RUN_INTEGRATION` **PASSED 2026-07-17, 5/5** (§8-22). Live
NAVER is **no longer the first browser execution of the recovery path**, and G4 **carries for Run 6 on that
basis** — *not* on the static ✅, which was signed against §8-2/§8-3 before A3 or A4 existed. The full
ratification, including its scope limits, is recorded once in [`r4-gate-record.md`](r4-gate-record.md) §G4.

⚠ **A4 narrowed the G4 question; it did not eliminate it.** Two seams are **executed by nothing offline**
and are **preserved as accepted live-first risks** — this is *not* Run 5's "offline-green, cite the proof"
shape, and the difference is why they are named rather than absorbed:

1. **`page.content()` mid-navigation** — §8-22's gate **awaits** its navigation, so the re-probe reads a
   **settled** page. **Run 6's premise IS the destroyed-context window** (§6). A throw **spends the G6**.
2. **`main()`'s `settleSpa` on the recovery branch** — the injected gate bypasses it. **Best-effort**: the
   driver's own settle stands behind it, so it costs latency, not the run.

**They are not equal, and the sheet does not treat them as one.** Expect the first; tolerate the second.

### G3 (scope: `session recovery`) — environment + §9-3 pause lift · ☐ NOT AFFIRMED

**The scope now exists** — ratified 2026-07-17 as the fifth ([`r4-gate-record.md`](r4-gate-record.md) §G3),
because Run 6 is none of the other four: read-only *in effect* (zero clicks, no download) but **not** the
§8-4 read-only probe — it drives the full engine and holds a live browser ~32 min.
⚠ **A ratified scope authorizes nothing.** The instance below is **☐ and stays ☐** until the dispatching turn.

- ☐ Stable network / IP / location still holds (the condition that paused NAVER live work).
- ☐ Dedicated Chrome connection profile intact; Operation Run persistence enabled.
- ☐ **§9 item 3 pause lift affirmed for a SESSION-RECOVERY run** — a fresh, single-run lift. **Not** a click
  lift, **not** a download lift, **not** an ingest lift, **not** general or standing. The Run 3 / Run 4 /
  Run 5 lifts authorize **nothing** here.
- ☑ G4 addressed **on the record** (above) rather than inherited — ratified 2026-07-17 on §8-22.
- ⚠ **REPORTED, NOT RESOLVED — the canonical G3 template's `☐ Bridge paired` box is inapplicable here.**
  [`r4-gate-record.md`](r4-gate-record.md) §G3 requires it, but this run is a **CLI run over a loopback**
  and §6's Bridge rung says verbatim *"the live driver is not yet Bridge-wired."* The box is not merely
  unchecked — **there is nothing for it to assert.** Affirming it vacuously and dropping it silently are
  both wrong; **whether the template should scope it is a product-owner call, untaken.**

### ⚠ The live window this G6 would authorize — ~21 min → ~32 min · ☐ NOT AFFIRMED

**[D-029](decisions.md)'s standing instruction, discharged here so it is not discovered at the seat.**
The **`max live window:` field was ratified 2026-07-17** and lives on the Run-6 G6 template
([`r4-gate-record.md`](r4-gate-record.md) §G6). **The field existing does not affirm the window** — the
operator affirms it, explicitly, in the dispatching turn.

| Phase | Budget |
|---|---|
| Phase A sentinel wait (`CONFIRM_TIMEOUT_MS`) | 10 min |
| **the recovery budget (`RECOVERY_BUDGET_MS`) — NEW in A3** | **10 min — SHARED across all attempts, not per attempt** |
| observe (`OBSERVE_TIMEOUT_MS`) | 10 min |
| download detect (`DOWNLOAD_TIMEOUT_MS`) | ~1 min |
| **worst case** | **~32 min** (31 min of budgeted waits + launch/probe overhead) — Runs 1–5 were **~21 min** |

**A G6 for this run authorizes roughly half again as much live browser time as any G6 ever has.** D-028's
boundary requires a fresh scope-matched G3 **and** a fresh single-use G6 — but it is **silent on duration**,
and duration is what A3 changed. **That silence is what the new field closes.**

⚠ **Assume the full ~32 min, not the healthy-path ~21.** The recovery budget is spent only if the run
**parks** — which for Run 6 is *the design*, not the exception.

### P6 — supervised-pilot sign-off · ☐ NOT SIGNED
- ☐ G1 ✅ · G2 ✅ · G5 ✅ carried in; **G4 ✅ addressed for THIS run** (above), not the static ✅.
  **G3 is deliberately not in this list** — it is per-run (D-026), carried by its own box.
- ☐ A **filled** `session recovery` G6 recorded in this dispatching turn (template ≠ approval).
- ☐ The `session recovery` **G3 instance** affirmed (above).
- ☐ §7 abort criteria acknowledged · ☐ seated-and-ready confirmed.
- ☐ Signed for **session recovery** scope only — **zero clicks**, no download, no validate, no ingest,
  terminal `FAILED`/`DOWNLOAD_TIMEOUT` at 2-of-3. **Explicitly does NOT authorize the §4.2 backend write**,
  and is distinct from Run 4's full-pilot P6 and Run 5's barrier P6.

### G6 — per-run approval · ☐ NOT FILLED

**The Run-6 template now exists** — one copy, in [`r4-gate-record.md`](r4-gate-record.md) §G6, ratified
2026-07-17 with the `max live window:` field. ⚠ **It is deliberately NOT restated here: one copy, one
source.** ⚠ **And a template is not an approval** — the template being written is the *last* thing that
happens before authorization, which is precisely why it must not be mistaken for it.

- ☐ Fresh, single-use, Run-6-scoped instance **filled and recorded in the dispatching turn**. **Consumed by
  the launch; VOID thereafter** — including if the run aborts, times out, parks and never recovers, or the
  operator is absent. A retry needs a new one.
- ☐ The longer live window affirmed **explicitly**, not inherited from the shape of Runs 1–5.

### §7 abort criteria · ☐ NOT ACKNOWLEDGED
- ☐ Acknowledged for this run — see §7, which **removes** a carve-out rather than inverting one.
- 🛑 **Run 4's confirmation-dialog carve-out DOES NOT APPLY.** No click ⇒ no dialog ⇒ **any** prompt or
  dialog on the export surface is an **abort**. The carve-out is exactly one dialog wide; this run is not in it.
- 🛑 **The recovery prompt is not a licence to improvise** — a normal login and nothing more.
- ✅ **A park is NOT an abort.** `WAITING_FOR_HUMAN` + `LOGIN_REQUIRED` at 0-of-3 is the run working as
  designed; aborting there discards its entire purpose.

### Seated and ready · ☐ — for ~32 minutes, and for TWO signals

- ☐ The operator confirms **"seated and ready" explicitly, before the run starts** — never inferred from
  silence, a prior run, or the sheet being complete.
- ☐ They understand this run asks for the ready signal **twice** (§4 steps 2 and 5), and that the **first is
  given while STILL LOGGED OUT — the inversion IS the run.**
- ☐ They understand **step 4 is the headline falsifier**: *they* return to the review-export surface; the
  Runtime never navigates.
- ☐ They understand **CLICK NOTHING** at step 7 — the lapse is the success condition, not a fault.
- ☐ They understand the seat is held up to **~32 min**.
- ⚠ **Operator-absent is the first explanation for a no-signal run, not a code bug.**
- ⚠ Unlike Run 5, a no-signal outcome here is **not** ambiguous: it lands `sentinel-timeout`, which says the
  gate was reached and the human did not act. **That is a spent G6, but it is not a confusing one.**

### Preconditions — ☐ NOT VERIFIED

- ☐ **The tree under test actually contains A3** (`cc9aba8`, PR #280). ⚠ **The recovery loop is the entire
  subject**: a tree without it reproduces Run 5's behaviour — park, then tear the browser down — and
  **answers nothing while still spending the G6.** Verify; do not assume.
  *(Checked 2026-07-17 on `31ec321`: `cc9aba8` (A3) and `4f31fc4` (A4) are both ancestors and the entrypoint
  carries `recoverLoop` / `awaitFreshSentinel` / `recoveryPrompt`. **A dated check is not this box** —
  re-verify against the tree the run actually launches from.)*
- ☐ **Decide whether to sync to `origin/main` first.** ⚠ **`main` moved after A4 landed** — PRs #283/#284
  (another workstream) put it at `ba39618`, 4 commits ahead of `31ec321`, with **zero `collector/` +
  `contracts/` change**, so a sync is **baseline-neutral** and the Runtime tree under test is unaffected
  either way. Recorded because a moving-ref snapshot rots: **re-derive it, do not trust this line.**
- ☐ **The backend should be DOWN, and that is deliberate.** Run 6 never ingests and — with zero clicks —
  **cannot** reach ingest at all. A down backend is belt-and-braces against a risk this run does not carry.
- ☐ **No `RUN_INTEGRATION`, no `AW_HEADED`.** This is the gated live entrypoint, nothing else.
- ☐ `NAVER_REVIEW_URL` + `COLLECTOR_BROWSER_CHANNEL` load from `.env` — **never echo the values.**
- ☐ `NODE_ENV` unset (the entrypoint independently refuses `NODE_ENV=production`, exit 4).

## 4. Operator choreography — this DEVIATES from the operator runbook, on purpose

⚠ [`r4-operator-runbook.md`](r4-operator-runbook.md) §2 tells the operator to **log in during Phase A and
then signal ready.** **Run 6 requires the opposite.** The runbook describes the **export pilot** and is
correct for it; **it must not be rewritten to describe Run 6, and the two must not be "reconciled"** — the
same rule Run 5 established. This record is the sole choreography for this run.

1. The collector opens a real Chrome window on NAVER and waits (`CONFIRM_TIMEOUT_MS` = 10 min).
2. ⚠ **Do NOT log in. Signal ready while still logged out.** *(In Claude Code, just say "ready".)*
   **This inversion IS the run.** A3's loop engages **only** if the run parks, and a park needs a probe that
   finds no valid session. A seller who logs in first produces a healthy run and answers nothing.
3. The Runtime probes, finds no session, and **PARKS** — `WAITING_FOR_HUMAN`, `LOGIN_REQUIRED`,
   `recoverable: true`, 0-of-3, **no `RUN_FAILED`**. A recovery prompt prints.
   **This is expected. It is the subject of the run, not a fault.**
4. **Now** complete the **NAVER-ID login**, and any **2FA / CAPTCHA**, yourself. Then **RETURN TO THE
   REVIEW-MANAGEMENT EXPORT PAGE.** ⚠ **This step is the headline falsifier** (question 2): the Runtime
   **never navigates**, so it will probe whatever page you are on. If you want to settle
   `selectedRangePresent` (question 3), **select a period / scope here** — using your own judgment, per
   [D-025](decisions.md); this record invents no procedure for it.
5. **Create the sentinel AGAIN** *(say "ready" a second time)*. ⚠ **The previous one was deliberately
   cleared** — a stale "ready" would fire the recheck against the same logged-out page and burn the loop.
   You have **10 minutes total** across all recovery attempts, not per attempt.
6. The Runtime **re-probes for real** — only that probe can clear the blocker; a human saying "I logged in"
   never does. Recovered → it prepares the surface, highlights the one export control, and waits.
7. ⚠ **CLICK NOTHING.** Let the observe window lapse. The run fails closed at `DOWNLOAD_TIMEOUT` / 2-of-3.
   **That is the success condition, not a fault.**

## 5. Evidence to record (sanitized) — a new dated §8-N in [`r4-evidence-pack.md`](r4-evidence-pack.md)

⚠ **The section number is assigned at dispatch, not now** — **§8-22 is A4**, so Run 6 lands at **§8-23**
*unless another slice claims it first.* This line has already moved once (it said §8-21 when A3 was the
last section); **re-check the pack, do not trust it.**

Enums / booleans / coarse buckets / SHA only. **Never** a URL, filename, path, selector, page content,
credential, cookie, token, exact count, or `eventTimeMs`.

- ☐ The filled Run-6 G6 instance (dispatching turn, date, operator, scope), and the ratified G3 scope.
- ☐ Final run view: `{ status, progress, channelCode, blockerCode? }` only.
- ☐ **`aw.live.recovery { outcome, attempt, blockerCode? }` — THE headline.**
  - `recovered` → **the loop works live.** The park→recover→continue arc is real on the real surface.
  - `still-blocked` → the re-probe ran and the session still is not valid. Says nothing about the loop.
  - `failed` + `blockerCode: UNSUPPORTED_STATE` → **D-028's falsifier lands FALSE** — logged in, but off the
    export surface. **A navigate seam becomes a real product-owner question.**
  - `failed` + `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS` → logged in, surface **READY**, control unlocatable —
    **a completely different finding**, and not about recovery at all.
  - `sentinel-timeout` / `budget-exhausted` → the seller ran out of time.
  - ⚠ `attempts-exhausted` → **the stale-sentinel trap reopened.** `MAX_RECOVERY_ATTEMPTS` is a spin
    backstop that should never fire. **Do NOT read it as "the seller gave up."**
  - ⚠ `driver-error` → see §6.
  - **All are publishable findings. Only `driver-error` is a defect.**
- ☐ **`aw.live.readiness { verdict, readinessDecision, readinessState?, readinessReason, readinessBranch,
  selectedRangePresent, dateRangeControlPresence, attempt }` — PER ATTEMPT.** Carries both D-028's falsifier
  and `selectedRangePresent`. The wire flattens every readiness HALT to `UNSUPPORTED_STATE`;
  `readinessBranch` is the only thing that says which rung fired.
  ⚠ **Withheld by design on `driver-error`** — a thrown probe leaves the diagnostic stale, so **its absence
  is evidence, not a gap.**
- ☐ `aw.live.barrier { observed: false }` — **expected**; nobody clicked. **Not a finding.**
- ☐ The Operation Run id (`run_…`): **alive at the park** (not FAILED), terminal at the end.
- ☐ No-leak assertion (`findProhibitedFields == []` across wire + store).
- ☐ **Non-mutation confirmation:** no click, no download fired, quarantine **never created**, `/api/uploads`
  never called.
- ☐ **If the seller selected a period/scope** (step 4), record `selectedRangePresent` against what they
  actually did — a `true` settles D-025's falsifier in the positive direction for the first time; a `false`
  against a real selection confirms the attribute-vs-property blindness offline tests predict.

## 6. What Run 6 does NOT prove

- **The export / download / ingest path.** Zero clicks — those legs are unreachable, not merely unused.
- **`COMPLETED` under the new two-window timing.** Untouched here; it still rests on Run 4's **old-timing**
  evidence. Re-proving it needs a separate **mutating** run with its own fresh export-scoped G6.
- **The Run 4 dialog's identity.** No click ⇒ no dialog. Still free to settle on any future click run.
- **The FE / Bridge recovery path.** The CLI is not the FE. `bridgeAdapter.ts`'s colliding commandIds after a
  reload are untouched, and D-028's accepted-cost of unbounded rechecks is bounded on the **CLI path only**.
- **Platform acceptance.** Nothing here says NAVER would have accepted anything.
- ⚠ **That recovery works in general.** A `recovered` is **one seller's post-login landing on one day** — an
  observation, not an invariant. D-028's limitation (the driver never navigates) is **unchanged** by a pass.

⚠ **The accepted risk the product owner declined to close (2026-07-17)** — and **re-affirmed by name in
G4's ratification** ([`r4-gate-record.md`](r4-gate-record.md) §G4), so it is carried knowingly, not
overlooked: `page.content()` at `naver-live-driver.ts` is **unguarded**, and `lastDiagnostic` is assigned
after it — so a thrown probe keeps the *previous* probe's value. Run 6's premise — a seller who just logged in and navigated — **is** the
canonical `Execution context was destroyed` window. A throw tears the driver down and **spends the G6**.
**Signature to record:** `aw.live.recovery { outcome: "driver-error" }` **with no `aw.live.readiness` for
that attempt.** A3 mitigates the *lie* at the CLI boundary; it does not prevent the *throw*.

## 7. Abort criteria

Full definitions in [`r4-preparation.md`](r4-preparation.md) §7 — **binding, not re-authored here.** Three
points this record restates, because Run 6 **removes** a carve-out rather than inverting one:

- 🛑 **There is NO expected dialog in this run.** Run 4's confirmation-dialog carve-out **DOES NOT APPLY** —
  no click means no dialog. **Any** prompt or dialog on the export surface → **abort**. The carve-out is
  exactly one dialog wide and this run is not in it.
- 🛑 **The recovery prompt is not a licence to improvise.** It asks for a normal login and nothing more.
  Anything unrecognized while logging in — CAPTCHA storm, lockout warning, an unexpected consent screen,
  on-screen data you did not expect to share, withdrawn consent → **you complete it or walk away; the
  Runtime never retries around it.**
- ✅ **A park is NOT an abort.** `WAITING_FOR_HUMAN` + `LOGIN_REQUIRED` at 0-of-3 is the run working as
  designed. Aborting there discards the run's entire purpose.

---

**Related:** [`r4-gate-record.md`](r4-gate-record.md) (gates + templates — authorization; **this run's G6
template does not exist there yet**) · [`r4-preparation.md`](r4-preparation.md) (§3 gates, §4 boundary, §6
ladder, §7 abort — normative) · [`r4-operator-runbook.md`](r4-operator-runbook.md) (the **export-pilot**
choreography — deliberately different from §4 above) · [`r4-evidence-pack.md`](r4-evidence-pack.md) (§8-20
A2-B and §8-21 A3 are the code under test; §8-16 Run 3 is this run's terminal shape) ·
[`decisions.md`](decisions.md) ([D-025](decisions.md) period/scope · [D-026](decisions.md) G3 per-run ·
[D-027](decisions.md) `--no-ingest` · [D-028](decisions.md) parks · [D-029](decisions.md) the loop) ·
[`HANDOFF.md`](HANDOFF.md).
