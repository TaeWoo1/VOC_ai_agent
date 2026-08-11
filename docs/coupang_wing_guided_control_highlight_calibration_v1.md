# Coupang WING Guided Control Highlight Calibration v1 — session handoff

**Branch** `feat/coupang-guided-control-highlight-calibration-v1`, from `main@2bedb2c4`.

The unit: measure the four controls the guided walk NAMES but could not point at — the `OPEN API` purpose
option, `확인`, and the two consent boxes — and promote to a highlight only what the measurement supports.
Auto-advance and recovery logic were out of scope and are untouched.

All four are now measured and ringed. Two live findings changed things the unit did not set out to change,
and both are on the record below.

---

## 1. What is ringed now, and on what evidence

Live-measured under `COUPANG_WING_ISSUANCE_FLOW_DISCOVERY`, `apr-c13e4ee4a7c3` / `wt-27f2e9010f82` @
`9c314ca0` (`wingrec_cdbf40748fe2`): four checkpoints, no halt, `PURPOSE → PURPOSE → TERMS → TERMS`, zero
probe faults, zero agent selections. **Every promotable reading was taken on two checkpoints of its screen and
agreed integer for integer, signature included.**

| promoted target | candidate | screen | visible | hidden | measured tag | broad sibling |
|---|---|---|---|---|---|---|
| purpose option | `stage2.purpose_open_api.label` | PURPOSE | 1 | 0 | `LABEL` | **2** — the narrowing is the finding |
| 확인 | `stage2.confirm.actionable` | PURPOSE | 1 | 12 | `BUTTON` | 1, **same signature** |
| API 약관 동의 | `stage3.terms.api_agree.label` | TERMS | 1 | 1 | `LABEL` | **2** (LABEL + SPAN nesting) |
| 카테고리 동의 | `stage3.terms.category_agree.label` | TERMS | 1 | 1 | `LABEL` | **2** |

The broad siblings are on the record deliberately. Four bare `visible: 1` rows say nothing about why the
shipped query is the narrow one; the siblings are what make each promotion checkable. `확인` is the exception
and the record says so — its broad query resolved to the *same element*, so nothing needed disambiguating.

**The consent rings sit on the SENTENCES, never on the boxes.** `WING_TERMS_CHECKBOX_PROMOTION_BLOCKED` still
holds: the inputs have no accessible association and nothing claims to know where an individual box is. What
ties each ring to its own consent is the per-row block census, **run live for the first time** on the same
pass: each box's nearest ancestor block holds exactly one consent sentence and exactly one visible checkbox,
at depth 1, 2/2. The manifest carries `ringedInputControlCount: 0` so this is machine-checked, not prose.

Operator-confirmed live on 2026-08-12: both purpose rings, both consent rings, correct positions, **no stale
ring carried between steps**.

## 2. The promotion bar, and the one clause that was wrong

A promotion requires: a live reading of the named candidate **on the screen the ring is drawn on**, `visible
== 1`, a **measured** tag, reproduced across ≥2 checkpoints, and `blockedReason: null`. Consent rings
additionally require the per-row block census. `guided-control-highlight-calibration.test.ts` refuses any
promotion missing any of it, and pins what is ringed today in one reviewable line.

The bar briefly also read `hiddenCount === 0`. That was an over-generalisation from one reading — the
key-creation control happens to measure `hidden: 0` on TERMS and `hidden: 1` on PURPOSE, so the same clause
would have refused it on the other screen. A hidden twin is excluded from the candidate set *before* the count
is taken, so it cannot be what a ring lands on; the visibility filter is the guard and the count is the
diagnostic that made the 발급 failure legible. It is now recorded as fragility on every reading
(`WING_GUIDED_HIGHLIGHT_HIDDEN_TWIN_POLICY`): if a twin ever paints, the locate returns 2 and the step fails
closed with the seller's own control still on screen. **Corrected with the operator's explicit decision**, not
silently.

## 3. `약관 동의 및 Key 발급받기` does NOT create the key — REFUTED live

On the 2026-08-12 walk (`apr-197d0cd2c9c7` / `wt-c5f5184e4a12` @ `7d19e624`) the operator pressed it —
**outside that run's approved scope, which budgeted zero presses of it** — and **no key was issued**. What
appears instead is an integration-method form: `OPEN API 키 발급` / `업체 입력 방식` / `연동업체 선택` /
`자체개발(직접입력)` / `업체명` / `취소` `확인`. The operator reports the key is issued by **that screen's
확인**.

The claim was asserted from the control's label and never observed, in **six** places — the manifest
operation, the preflight disclosure, the probe's warning, the target's doc comment, and the Korean sentence
the seller reads on the WING page. Nobody had pressed it, because every phase correctly refused to; so the one
observation that could settle it was the one the boundary prevented. That is not an argument against the
boundary. It is why a claim of this shape has to be written down as an expectation until something observes
it, exactly as `pressOutcome: "UNCONFIRMED"` is on the 발급 record.

**The product owner was right all along, about a screen nobody could reach.** The original flow description
(발급 → 연동 방식 선택 → 자체개발(직접입력) → 업체명 · URL · IP 주소 → 확인) was judged "wrong about the
ordering" on 2026-08-10 when the purpose screen led to TERMS. It was not wrong — the vendor form sits *after*
the terms, and every reading since measured 업체명 / URL / IP 주소 as present-but-hidden for exactly that
reason.

Recorded in `WING_KEY_CREATION_CONTROL_REFUTATION`: the press, that it was out of scope, that no key was
issued, and that the vendor screen is `OPERATOR_REPORTED_NOT_MEASURED`. **Nothing may be promoted, guided or
auto-advanced from it.**

The walk still rests at the same control. Only the reason changed, and it is now the true one: *what follows
has never been measured.* The seller-facing copy no longer warns about a consequence that does not happen — a
warning attached to a non-event spends the credibility the true ones need — and the selfcheck requires the new
sentences and refuses the retired one.

## 4. Live runs, in full

| run | scope | what happened |
|---|---|---|
| `apr-435e…` / `wt-d39e…` @ `d0538abc` | discovery, 7 targets | **HALTED** at checkpoint 2, `CONFIRM_ADVISORY_STOP / STOP_NOT_MEASURED`. My scoping error: the 확인 advisory reads the vendor-form rows and I had narrowed them out. Two PURPOSE readings survived. |
| `apr-f9d6…` / `wt-de01…` @ `622737c4` | discovery, 12 targets | **HALTED** at checkpoint 4, `SCREEN_NOT_AS_EXPECTED`. The operator had not pressed 확인 — my step-3 instruction was ambiguous. Reading was correct; nothing was pressed. |
| same approval, retry | same | **COMPLETE**, 4 checkpoints. Emitted `observedTag: null` throughout — the record emitter dropped it (the fourth seam). Not cited for any promotion. |
| `apr-c13e…` / `wt-27f2…` @ `9c314ca0` | discovery, 12 targets | **COMPLETE**. The measurement §1 rests on. |
| `apr-197d…` / `wt-c5f5…` @ `7d19e624` | guided walk | Rings confirmed. **Out-of-scope press** of the key-creating control → §3. Rings slower than the single-ring ones. |
| `apr-c61b…` / `wt-83f0…` @ `2138fdf6` | guided walk | Rings + copy confirmed, delay largely closed. **Second out-of-scope press** of the same control, operator-reported as accidental; no key issued. |

Both out-of-scope presses are recorded rather than smoothed over. A record that reports the boundary holding
when it did not is worth less than no record.

## 5. Defects found and fixed along the way

1. **A discovery scope that cannot finish refuses before Chrome.** Two downstream gates fail closed on an
   unprobed row — screen identity, and the 확인 advisory — and both fired *after* the operator had logged in
   and pressed a real control. The requirement is now a union derived from both gates, so neither can be
   extended without the other. Cost one sitting to learn; the guard added after the first halt covered one gate
   and left its sibling standing, which is this workstream's recurring shape.
2. **The measured tag was dropped at four seams**, the last being the emitted record. A run could measure it
   four times and still produce a record from which no promotion could cite one — which is how `role:
   "button"` came to be asserted from `WING_TARGET_EXPECTED_ROLE`. `expectedRole` had always been on the
   record and the measurement never was. The test is at the **artefact**, not per layer: each of the four seams
   had passing tests throughout.
3. **The overlay ringed only the first tagged element.** Two consents cannot be expressed by one ring. It now
   rings every tagged control, chip and shroud on the primary, shroud dropped above one ring because two of
   them stack. The docked-mode stale-anchor guard existed at mount and was missing in the repositioner.
4. **Ring latency, live-observed.** A two-control step cost five page evaluations. The whole plan is now one,
   and atomic where the sequence could not be: every spec is resolved before anything is tagged, so a partial
   ring set never exists on the page.
5. **The Korean operator summary went stale** while the English disclosure beside it was updated — it told the
   operator the promoted controls carry no highlight, on the run that promoted them. Caught on the displayed
   manifest, before any grant. The selfcheck now refuses the retired Korean claims too.
6. **The correction to the step-5 copy made a dead end reachable by following it.** Found by `/code-review
   high`, not by the suite. The new text ended "press the button below once the next screen appears" — that
   screen is the integration form, and advancing lands on step 6, whose locator queries `Access Key`, which
   does not paint there. The run would park `target_not_found` on a step the seller had just been told to
   enter. The advance is now gated on the credentials being visible, which is the precondition step 6's locator
   actually needs. **A correction that creates a new failure is not a correction**, and this one was mine, an
   hour old, and green.
7. **The FE step TITLE still asserted the refuted claim** (`… 직접 누르기 (키 생성)`) while the detail string 70
   lines below said the opposite — both on one screen, in front of the seller. Six further comment/prose sites
   were still stating withdrawn facts, including `WING_KEY_CREATION_CONTROL_ID`'s own header with the
   refutation directly beneath it, and the disclosure's "no guided step is text-only any more" (two steps still
   are — the field counts CONTROLS). `COUPANG_ISSUANCE_KEY_CREATION_STEP`'s doc claimed step 5 is the
   irreversibility wall; it is at least one unmeasured screen further on. The constant is **not** renamed: the
   real boundary is unknown, and a name that is a second guess is worse than one whose doc says so.
8. **`IN_PAGE_CLEAR_TAG` stripped one of the two ring markers.** Both tagging scripts write the pair, so a
   stale `data-aw-primary` could survive a clear and put the chip on the wrong control. Unreachable with
   today's two ring plans, repaired anyway — same shape as (1).

## 6. Remaining

1. **The vendor-form step is not in the walk's model.** After `약관 동의 및 Key 발급받기` there is a screen the
   walk does not know about, and the key is issued there. This is a **separate unit**: it is flow logic (out of
   scope here), no apparatus has ever read that screen, and it needs its own measurement pass and its own
   approval scope. Until then the walk correctly stops one step early, and its copy says so.
2. **Residual ring latency.** Better after the batching, still slightly present per the operator. The round
   trips are no longer the cost; what remains is the fixed `LOCATOR_SETTLE_MS` (400 ms, a defensive wait
   written for the single-spec path and never measured as needed) plus up to `SCREEN_OBSERVE_POLL_MS` (1 s)
   before an auto-advancing step even notices WING changed. Both are candidates; neither was touched here
   because removing a defensive delay on reasoning alone is the move this workstream distrusts.
3. **The batched ring path is live-proven** on the 2026-08-12 verification run — rings, positions, copy, and no
   stale ring, all operator-confirmed.
