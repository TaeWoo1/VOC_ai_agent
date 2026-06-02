# Phase 1 signal-quality — canonical baseline

**Frozen:** 2026-04-25 (v1.13 cautionary / v1.1 positive / v0.6-draft golden) — Phase 2D golden-labeling gap correction (Step 2)
**Previous snapshot:** 2026-04-24 — v1.13 cautionary / v1.1 positive / v0.5-draft golden · recall_mapped = 46/57 = 0.8070
**Scope owner:** `scripts/eval_phase1_baseline.sh` (authoritative; see "Guard" below)

This file is the single source of truth for Phase 1 signal-quality numbers.
Any claim about recall/precision outside this scope must cite the scope it
used. Re-snapshot this file whenever the lexicon, golden, or signal_map
version changes — preferably in the same commit.

---

## Canonical scope (reviewed-only)

- **product IDs** (all products with ≥1 labeled row today):
  `6870288119`, `7156638510`, `7287282252`, `7683282996`,
  `8801742659`, `9182625401`, `9205394095`, `A000000238828`
- **label filter:** `--reviewed-only` — `status == "reviewed"` rows only.
  Rationale: draft rows are mutable; excluding them keeps the same command
  re-runnable during curator edits. Draft rows become part of the unlabeled
  universe (their rows can still count as FPs if a signal fires on them).
- **golden:** `eval_data/phase1/phase1_signals_golden.json` · **v0.6-draft**
- **signal_map:** `eval_data/phase1/phase1_signal_map.json` · v0.9-draft
- **lexicons:** `data/phase1_lexicons/positive.json` v1.1 +
  `data/phase1_lexicons/cautionary.json` v1.13 *(unchanged — this snapshot
  reflects a golden-labeling-gap correction only, not a lexicon or detection
  change)*

### Exact command

```bash
scripts/eval_phase1_baseline.sh                 # markdown report
scripts/eval_phase1_baseline.sh --emit-json     # JSON output
```

This wraps:

```bash
python3 scripts/score_phase1_signals.py \
  --product-id 6870288119 --product-id 7156638510 --product-id 7287282252 \
  --product-id 7683282996 --product-id 8801742659 --product-id 9182625401 \
  --product-id 9205394095 --product-id A000000238828 \
  --reviewed-only
```

### Summary

| field | value |
|---|---:|
| labeled (included / total) | 52 / 53 |
| reviews in universe | 1224 |
| scored signals | 9 |
| `recall_mapped` (TP / n_expected) | **61 / 73 = 0.8356** |
| total TPs | 61 |
| total FPs | 5 |
| total FNs | 12 |
| coverage-gap tags | 2 |
| coverage-gap review count | 3 |

### Per-signal scores

| signal | n_exp | n_fired | TP | FP | FN | precision | recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| `application_issue` | 18 | 15 | 15 | 0 | 3 | 1.00 | 0.83 |
| `coupang_authenticity_concern` | 2 | 2 | 2 | 0 | 0 | 1.00 | 1.00 |
| `packaging_complaint` | 6 | 6 | 6 | 0 | 0 | 1.00 | 1.00 |
| `persistence_reservation` | 8 | 11 | 7 | 4 | 1 | 0.64 | 0.88 |
| `pigment_complaint` | 19 | 17 | 16 | 1 | 3 | 0.94 | 0.84 |
| `shade_mismatch` | 5 | 4 | 4 | 0 | 1 | 1.00 | 0.80 |
| `skin_irritation_concern` | 2 | 2 | 2 | 0 | 0 | 1.00 | 1.00 |
| `tone_mismatch` | 7 | 3 | 3 | 0 | 4 | 1.00 | 0.43 |
| `value_complaint` | 6 | 6 | 6 | 0 | 0 | 1.00 | 1.00 |

### v1.14 change notes (2026-04-25, Phase 2D golden-labeling gap — Step 2)

**Type:** golden-labeling-gap correction. **Not** a lexicon or detection
change — `cautionary.json` v1.13, `positive.json` v1.1, and
`src/voc/reporting/phase1/signals.py` are unchanged. Only
`phase1_signals_golden.json` version bumped `0.5-draft → 0.6-draft`.

**Provenance:** `docs/phase2_golden_labeling_gap_review.md` (Step 1
candidate list → Step 1.5 focused curator review of 3 high-risk 5★
ADD-new rows → Step 2 this snapshot).

**Golden edits applied (15 ADD records across 12 distinct rows):**

*5 new reviewed entries added:*
| review_id | channel | rating | concern | signal closed |
|---|---|---:|---|---|
| `157bb279ee383d42` | oliveyoung | 3★ | `durability_concern` | persistence_reservation |
| `89c12a8149c1c42f` | coupang | 5★ | `durability_concern` | persistence_reservation (structured 아쉬웠던 점 section) |
| `ad56e23953a1a463` | coupang | 4★ | `pigment_complaint` | pigment_complaint |
| `bf6d481209f36168` | coupang | 4★ | `pigment_complaint` | pigment_complaint |
| `a89bdf62478c8474` | coupang | 5★ | `value_complaint` | value_complaint (rating-text mismatch) |

*7 draft→reviewed promotions (pre-existing concerns preserved, no tag changes):*
| review_id | channel | rating | concerns (unchanged) | signals closed |
|---|---|---:|---|---|
| `6708e93dd69647a3` | oliveyoung | 5★ | `durability_concern` | persistence_reservation |
| `bd9225a6719ea281` | oliveyoung | 5★ | `durability_concern` | persistence_reservation |
| `29a978f2f9218482` | coupang | 1★ | `pigment_complaint`, `value_complaint` | pigment_complaint + value_complaint |
| `7572f7d9b5f31de9` | coupang | 2★ | `shade_mismatch`, `pigment_complaint`, `return_intent` | pigment_complaint |
| `79debf929212102b` | coupang | 1★ | `pigment_complaint`, `value_complaint` | pigment_complaint + value_complaint |
| `ab81d094b6fdc188` | coupang | 1★ | `marketing_deception`, `pigment_complaint` | pigment_complaint |
| `f2e41a0800ab3e90` | coupang | 1★ | `authenticity_doubt`, `skin_irritation` | skin_irritation_concern + coupang_authenticity_concern |

**Rows intentionally NOT merged (held for separate curator judgment):**

*2 DEFER rows (downgraded from ADD during focused curator review):*
| review_id | target signal | reason |
|---|---|---|
| `52dfdb044c27405f` | pigment_complaint | 5★ with self-neutralized 단점 ("단점이라기 보다") + strong-positive conclusion. No 5★ pigment_complaint precedent in golden. |
| `47a9009b2cb0dc4a` | persistence_reservation | 5★ weak softened caveat ("지속력이 약간 아쉽긴 하지만") with concessive pivot; precedent-dependent only. |

*3 LEAVE rows (pattern over-matches, never labeled):*
| review_id | target signal | reason |
|---|---|---|
| `15c56921d4...` | persistence_reservation | anaphora (previous powder blusher, not reviewed product) |
| `177fdbc776...` | persistence_reservation | anaphora (A-vs-B contrast structure) |
| `a775a234c2...` | persistence_reservation | hypothetical ("-ㄹ 수 있습니다" conditional) |

**Per-signal numerical deltas:**

| signal | recall v1.13 → v1.14 | precision v1.13 → v1.14 | notes |
|---|---|---|---|
| `persistence_reservation` | 0.75 → **0.88** (+0.13) | 0.27 → **0.64** (+0.37) | 4 new reviewed rows promoted/added (157bb279ee, 89c12a8149, 6708e93dd6, bd9225a671). 4 FPs remain: 3 LEAVE (anaphora×2 + hypothetical) + 1 DEFER (47a9009b2c). FN=1 unchanged. |
| `pigment_complaint` | 0.77 → **0.84** (+0.07) | 0.59 → **0.94** (+0.35) | 6 new reviewed rows (29a978f2f9, 7572f7d9b5, 79debf929, ab81d094b6, ad56e23953, bf6d481209). 1 FP remains: 52dfdb044c (DEFER). FN=3 unchanged. |
| `value_complaint` | 1.00 → 1.00 | 0.50 → **1.00** (+0.50) | 3 new reviewed rows (29a978f2f9, 79debf929, a89bdf6247). All 3 prior FPs closed; 0 FPs remain. |
| `skin_irritation_concern` | 1.00 → 1.00 | 0.50 → **1.00** (+0.50) | 1 promotion (f2e41a0800). Prior 1 FP closed. |
| `coupang_authenticity_concern` | 1.00 → 1.00 | 0.50 → **1.00** (+0.50) | 1 promotion (f2e41a0800). Prior 1 FP closed. |
| `shade_mismatch` | 1.00 → 0.80 (−0.20) | 1.00 → 1.00 | Secondary effect of promoting 7572f7d9b5, whose `shade_mismatch` concern tag entered `expected_by_signal` but the pipeline does not fire `shade_mismatch` on this row. Previously a silent coverage gap; now surfaces as 1 FN. **Pattern side unchanged** — this is pure golden-denominator bookkeeping, not a detection regression. |
| `application_issue` / `packaging_complaint` / `tone_mismatch` | unchanged | unchanged | No rows added or promoted that affect these signals. |

**Overall deltas:**
- `recall_mapped`: 0.8070 → **0.8356** (+0.0286).
- TPs: 46 → 61 (+15). All 15 TP gains trace to ADD records documented above.
- FPs: 20 → 5 (−15). The 15 FP closures are the direct inverse of the 15 TP gains.
- FNs: 11 → 12 (+1). The single new FN is `7572f7d9b5 × shade_mismatch`,
  a bookkeeping side-effect of promoting a multi-concern row; no pattern
  regression.
- Detection rules unchanged. No lexicon / no code edit. All recall-side
  movement is attributable to golden-denominator bookkeeping plus new
  reviewed expected set membership.

**Coverage gaps:** grew from 1 to 2. The added gap is `return_intent`
(promoted with `7572f7d9b5`; tag has empty mapping in signal_map v0.9-draft,
so it contributes to `coverage_gaps` only). This is expected and not a
regression.

**Residual FPs after Step 2:**
- `persistence_reservation` FP=4: `15c56921d4`, `177fdbc776`, `a775a234c2` (LEAVE), `47a9009b2c` (DEFER)
- `pigment_complaint` FP=1: `52dfdb044c` (DEFER)

These 5 residuals are **intentional** and reflect the discipline of the
Step 1.5 focused curator review. They are not candidates for pattern
tightening without re-opening the DEFER decisions.



### v1.13 change notes (2026-04-24, Phase 2B careful tier — pigment)

Scope: `docs/phase2_coverage_audit.md` §G.2 — "careful tier / pigment_complaint"
only. Did NOT touch: tone_mismatch; the opposite-polarity `"색이 강"` candidate
for event #3. Also rejected the comparative frame `"(가루|스틱|크림)보다 연"` —
polarity-check showed too-ambiguous ("보다 연해요" is used as positive descriptor
at comparable frequency to cautionary).

**Lexicon changes:**
- `cautionary.json` v1.12 → v1.13:
  - `pigment_complaint` +5 patterns:
    - `"티도안나"` — closes event #2 (text uses fused `"티도안나고"`)
    - `"별로 안나서"` — closes event #4 (actual text: `"티가 별로 안나서"`; chosen over broader `"티가 별로 안나"` because the broader pattern had 1 × 5★ ambiguous hit)
    - `"흰 끼 돌"` — closes event #7 (review title includes `"흰 끼 돌아요"`)
    - `"발색이 약합"` — supplementary; catches declarative 합니다-form
    - `"발색이 너무 약"` — supplementary; catches intensifier-framed cautionary

**Rejected candidates (≥1 × 5★ FP on corpus):**
- `"티가 안 나"` — 2 × 5★ FPs including clean "장점이에요" positive compound
- `"티가 별로 안나"` — 1 × 5★ ambiguous (prefer "별로 안나서" instead)
- All comparative frames (`"보단 연해"`, `"보다 연해"`, `"스틱보단 연"`, `"크림보다 연"`, etc.) — **entire family rejected**. In cosmetic reviews, "X보다 연해요" is used as a positive descriptor ("lighter than Y, which is actually good for daily use") at a frequency comparable to cautionary usage. No pattern variant of the comparative frame tested clean.
- `"흰끼 돌"` (no space), `"흰끼가 돌"`, `"흰 끼가"` — multiple 5★ FPs on positive-descriptor use ("흰 끼가 적당히 섞여 있어서 깨끗하게")
- `"발색이 약"` — 7 × 5★ hits mixed mitigation / hypothetical / positive constructs; pattern too broad
- `"발색이 약해"` — 1 × 5★ clean FP on hypothetical explanatory context
- `"발색력이 약"` — 1 × 5★ clean FP on comparative mitigation

**Per-signal numerical deltas:**

| signal | recall v1.12 → v1.13 | precision v1.12 → v1.13 | notes |
|---|---|---|---|
| `pigment_complaint` | 0.54 → **0.77** (+0.23) | 0.58 → **0.59** (+0.01) | Closed 3 FNs (#2, #4, #7). 2 new "FPs" (`52dfdb044c`, `ad56e23953`) — **both semantically cautionary fires on unlabeled rows**, not pattern over-matches. Pattern-induced true FP count: **0**. All 7 current FPs are labeling gaps (similar shape to persistence_reservation's FP profile). |
| all other signals | unchanged | unchanged | No retuning in this pass. |

**Overall:**
- `recall_mapped`: 0.7544 → **0.8070** (+0.0526).
- TPs: 43 → 46 (+3). All three FN closures landed cleanly.
- FPs: 18 → 20 (+2). Both new FPs are semantically cautionary. Pattern-induced true FP rate this pass: **0**.
- FNs: 14 → 11 (−3).

**Remaining 11 FNs (deterministic closure frontier saturated):**

| signal | FN count | remaining rows | bucket / closure path |
|---|---:|---|---|
| `application_issue` | 3 | #8 (text `"바름뭉침"` vs curator paraphrase), #11 ((d) conditional frame), #12 ((a) but polarity-rejected on `"벗겨짐 없"` FPs) | text-divergence / (d) / polarity-unsafe |
| `persistence_reservation` | 1 | #18 ((a) but `"흐릿"` polarity-rejected) | polarity-unsafe |
| `pigment_complaint` | 3 | #3 (opposite polarity `"색이 강"`, intentionally deferred), #5 ((c) diffuse), #6 (comparative-rejected) | deferred / (c) / polarity-unsafe |
| `tone_mismatch` | 4 | all 4 events ((d) compositional) | **exclusively Phase 2C LLM territory** |

Zero of the 11 remaining FNs are straightforward deterministic closures.
Every one falls into one of: text-divergence, (c)/(d) bucket from audit,
polarity-rejected-under-discipline, or intentionally-deferred. Deterministic
closure is **effectively saturated** at v1.13.

### v1.12 change notes (2026-04-24, Phase 2B small-win tier)

Scope: `docs/phase2_coverage_audit.md` §G.2 — "small-win tier" only.
Did NOT touch: pigment_complaint, tone_mismatch, persistence_reservation
(cleanup deferred — see "Second-order observations" at bottom of this
section).

**Lexicon changes:**
- `cautionary.json` v1.11 → v1.12:
  - `value_complaint` +1 pattern: `"돈아까"` (no-space variant of the
    existing `"돈 아까"`; the actual text in event #21 is `"돈아까워"`,
    fused). 1 × ≤3★ hit on corpus, 0 × ≥4★ FPs. Closes event #21.

**Code changes:**
- `src/voc/reporting/phase1/signals.py` `_SKIN_IRRITATION_TEXT_PATTERNS`
  += `"피부가 올라"` (specific-phrase exception to the existing
  conjunctive-only design). 1 × ≤3★ hit on corpus (= event #23),
  0 × ≥4★ FPs. "피부톤이 올라" (positive construct) does not match
  because substring match requires the `가` particle. Closes event #23.
  Comment updated to document the non-conjunctive exception.

**Per-signal numerical deltas:**

| signal | recall v1.11 → v1.12 | precision v1.11 → v1.12 | notes |
|---|---|---|---|
| `skin_irritation_concern` | 0.00 → **1.00** (+1.00) | 0.00 → **0.50** (+0.50) | Closed the 1 FN (#23, `"피부가 올라"`). The 1 FP is pre-existing from prior conjunctive patterns; not from this pass. |
| `value_complaint` | 0.67 → **1.00** (+0.33) | 0.40 → **0.50** (+0.10) | Closed the 1 FN (#21, `"돈아까"`). 0 new FPs. The 3 remaining FPs are pre-existing; negation filter evaluated but rejected — all 3 are golden-label gaps (semantically cautionary fires on unlabeled rows), not pattern errors. Enabling filter would have suppressed 1 legitimate cautionary fire (`"왜 비싼지 1도 모르겠음"` — `모르` is a negation particle). |
| all other signals | unchanged | unchanged | No retuning in this pass. |

**Overall:**
- `recall_mapped`: 0.7193 → **0.7544** (+0.0351).
- TPs: 41 → 43 (+2). Both pattern closures landed cleanly.
- FPs: 18 → 18 (**unchanged** — zero new FPs added this pass).
- FNs: 16 → 14 (−2).

**Second-order observation (flagged; out of scope for this PR):**
`persistence_reservation` has P=0.27 with 8 fires counted as FPs. 5 of
those 8 are semantically cautionary fires on rows the golden does not
label as `durability_concern` (`157bb279ee`, `47a9009b2c`, `89c12a8149`,
`bd9225a671`, `6708e93dd6`). Only 3 are true pattern over-matches
(anaphora / hypothetical). A per-pattern tightening pass would trade
recall for precision with little gain; the precision signal here will
self-correct when a golden-label review pass (candidate work for
Phase 2C LLM-assisted labeling) catches up with the pipeline's
coverage. No persistence cleanup scheduled.

### v1.11 / v1.1 change notes (2026-04-24, Phase 2B start-here tier)

Scope: `docs/phase2_coverage_audit.md` §G.2 — "start-here tier" only.
Did NOT touch: pigment_complaint, value_complaint, skin_irritation_concern,
tone_mismatch. Careful-tier and small-win-tier deferred to later passes.

**Lexicon changes:**
- `cautionary.json` v1.10 → v1.11:
  - `application_issue` +4 patterns: `"손으로 바르면 뭉침"`, `"양조절이 조금 어려"`,
    `"난이도가 있"`, `"베이스 벗겨져"`. Each was polarity-checked; broader
    candidates (`"바르면 뭉침"`, `"양조절이 어려"`, `"양조절이 힘들"`, `"베이스
    벗겨짐"`) were **rejected** due to ≥1 × 5★ FP on positive-compound /
    mitigation constructs.
  - `persistence_reservation` +8 patterns: `"색이 금방 날라"`, `"금방 날라가"`,
    `"금방 날아가"`, `"어느순간 사라"`, `"유지력이 아쉬"`, `"유지력이 약"`,
    `"지속력이 약"`, `"지속력 약함"`.
- `positive.json` v1.0 → v1.1 (**hidden-bug fix surfaced during audit**):
  - `no_base_crumbling` — replaced overly-broad pattern `"벗겨지"` with
    specific `"벗겨지지"` + `"안 벗겨지"`. The old pattern matched active
    cautionary verb forms (`"벗겨지는게 가장 큰 문제"`, `"벗겨지긴 해서
    아쉬워요"`) as positive no-base-crumbling fires — 8+ rows across the
    1224-row corpus had this bug. See `docs/phase2_coverage_audit.md`
    §F event #10 for discovery details.

**Code changes:**
- `src/voc/reporting/phase1/signals.py`:
  - `_AUTHENTICITY_TEXT_PATTERNS` +`"짭퉁"` (colloquial variant of `"짝퉁"`;
    closes coupang_authenticity_concern FN at event #22).
  - `_NEGATION_FILTERED_SIGNALS` + `"persistence_reservation"`. Needed
    because the new persistence patterns ("금방 날아가", "지속력이 약") can
    appear inside negation-compound positive constructs (e.g. "금방
    날아가지 않고 오래"). Filter suppresses clean-negation FPs; anaphora
    and partial-cautionary-in-5★ fires are accepted residue.

**Per-signal numerical deltas:**

| signal | recall v1.10 → v1.11 | precision v1.10 → v1.11 | notes |
|---|---|---|---|
| `application_issue` | 0.72 → **0.83** (+0.11) | 1.00 → 1.00 | Closed 2 FNs (#9, #10); precision held. Event #8 remains FN — text uses `"바름뭉침"` (fused noun form), not the `"바르면 뭉침"` the curator note paraphrased. Event #11 (d-compositional) and #12 (polarity-rejected) still FN as expected. |
| `persistence_reservation` | 0.00 → **0.75** (+0.75) | 0.00 → **0.27** (+0.27) | Closed 3 FNs (#17, #19, #20). Event #18 intentionally deferred (pattern "흐릿" had unacceptable 5★ polarity risk). 8 "FPs" breakdown: 3 true over-matches (anaphora/hypothetical), 5 unlabeled-cautionary mentions the golden file did not label — flagged as golden-review candidates, not pattern failures. |
| `coupang_authenticity_concern` | 0.00 → **1.00** (+1.00) | 0.00 → **0.50** (+0.50) | Closed the 1 FN (#22, `"짭퉁"`). The remaining 1 FP is pre-existing from a prior pattern, not from this pass. |
| all other signals | unchanged | unchanged | No retuning in this pass. |

**Overall:**
- `recall_mapped`: 0.6140 → **0.7193** (+0.1053).
- TPs: 35 → 41 (+6).
- FPs: 12 → 18 (+6). Pattern-induced true FPs: +3 (all persistence_reservation
  anaphora/hypothetical). The other +3 are pre-existing or golden-labeling
  gap surfacing — neither a regression of prior patterns nor overclaim.
- FNs: 22 → 16 (−6).

**Second-order observations (flagged; out of scope for this PR):**
- 5 persistence_reservation fires on 3★–5★ rows that expressed real
  durability concerns but were not labeled `durability_concern` in the
  golden: `157bb279ee` (3★), `47a9009b2c`, `89c12a8149`, `bd9225a671`,
  `6708e93dd6` (all 5★). Candidates for a golden-label review pass.
- The `no_base_crumbling` over-match bug was **wider than event #10**:
  the old `"벗겨지"` pattern fired positive on at least 8 cautionary rows
  across the corpus. Fix closed those as side effect. Does not affect
  `recall_mapped` (no_base_crumbling is positive-only, not mapped).

### v1.10 / v0.5-draft change notes (2026-04-24, retained for continuity)

- `cautionary.json` v1.9 → v1.10: added 7 base-crumbling patterns to
  `application_issue` (`베이스가 까져요`, `베이스가 까짐`, `베이스가 잘 까`,
  `베이스가 너무 잘 까`, `베이스 까짐이 너무`, `베이스 다 밀려`, `다 벗겨져요`).
  All patterns passed polarity safety (0 × 5★ hits).
- `phase1_signals_golden.json` v0.4-draft → v0.5-draft: added 7 reviewed
  labels (all `application_difficulty`) on rows the new patterns correctly
  caught but were previously unlabeled.
- Net effect: `application_issue` precision held at 1.00; recall 0.55 → 0.72.
  Overall `recall_mapped` 0.5600 → 0.6140. No other signals' numbers moved —
  concerns on the added labels were intentionally scoped to
  `application_difficulty` only to keep every other signal's baseline
  frozen.
- Motivating audit: `docs/performance_validation_v1.md`.

### Coverage gaps (labeled concerns with no pipeline signal)

| tag | n reviews | example review_ids |
|---|---:|---|
| `marketing_deception` | 1 | `b5d61417bc` |

Known pre-existing weak signals (documented, **not in scope for packaging PR**):
`persistence_reservation`, `coupang_authenticity_concern`,
`skin_irritation_concern` (all P=0.00, R=0.00 on reviewed-only); `pigment`
(P=0.58); `value` (P=0.40). Addressing these is separate follow-up work.

---

## Divergence attribution — why prior numbers looked different

A previously-recalled baseline claimed `recall_mapped = 0.56 (28/50)`,
`coverage_gap_review_count = 15`, with pigment precision 0.92 and value
precision 0.80. Those numbers are not wrong — they were measured on a
different scope. The single difference is the `--reviewed-only` flag.

| dimension | summary-recalled run | current session run | attribution |
|---|---|---|---|
| product IDs | all 8 with labeled rows | same 8 | unchanged |
| universe size | 718 | 718 | unchanged |
| golden version | 0.4-draft | 0.4-draft | unchanged |
| signal_map version | 0.7-draft (packaging unmapped) | 0.8-draft (packaging mapped) | expected delta for this PR |
| **label filter** | **all labels** | **`--reviewed-only`** | **the root cause** |
| `recall_mapped` | 28 / 50 = **0.5600** | 18 / 40 = 0.4500 (simulated pre-packaging) | flag drift, not a regression |

Re-running the current session's invocation **without** `--reviewed-only`
reproduces the summary-recalled baseline exactly:

- `recall_mapped = 28 / 50 = 0.5600` ✓
- `coverage_gap_review_count = 15` ✓
- `pigment_complaint precision = 0.92` ✓
- `value_complaint precision = 0.80` ✓
- all other mapped signals precision = 1.00 ✓

Conclusions by category:

- **Stale summary text:** not stale. The numbers were accurate at
  measurement time for their scope.
- **Changed golden labels:** no. Label count and content match (41 total;
  differences visible in the run are driven by the reviewed-only filter,
  not label edits).
- **Changed signal_map:** yes, but only the additive `packaging_complaint`
  bridge added this PR. All other tag→signal mappings unchanged.
- **Changed universe / scope:** no. Same 8 product IDs, same 718 universe.
- **Changed `--reviewed-only` filtering:** **this is the full explanation.**
  Flipping the flag moves ~8 draft rows between "labeled" and "unlabeled,"
  which shifts precision, recall, and coverage_gap all at once and in
  opposite directions depending on the signal.

### Unknowns

- **Why the flag flipped between measurements.** The `--reviewed-only`
  discipline was a session-level preference; the summary-producing run
  predated it being applied consistently. There is no git history on the
  untracked lexicon / signal_map / golden files to cross-reference.
- **What scope the next human reader will assume.** Addressed by the guard
  script (`scripts/eval_phase1_baseline.sh`) which fixes the flag.

---

## Historical (all-labels) snapshot — for continuity only

Recorded to keep previously-cited numbers interpretable. **Do not use as a
live baseline** — draft labels mutate, so this view is not re-runnable
stably across curator sessions.

Command:

```bash
python3 scripts/score_phase1_signals.py \
  --product-id 6870288119 --product-id 7156638510 --product-id 7287282252 \
  --product-id 7683282996 --product-id 8801742659 --product-id 9182625401 \
  --product-id 9205394095 --product-id A000000238828
```

| field | value |
|---|---:|
| labeled (included / total) | 41 / 41 |
| reviews in universe | 718 |
| scored signals | 9 |
| `recall_mapped` | **38 / 61 = 0.6230** |
| total TPs | 38 |
| total FPs | 2 |
| total FNs | 23 |
| coverage-gap review count | 4 |

Per-signal under all-labels (for reference):

| signal | exp | fired | TP | FP | FN | P | R |
|---|---:|---:|---:|---:|---:|---:|---:|
| application_issue | 11 | 6 | 6 | 0 | 5 | 1.00 | 0.55 |
| coupang_authenticity_concern | 2 | 1 | 1 | 0 | 1 | 1.00 | 0.50 |
| packaging_complaint | 6 | 6 | 6 | 0 | 0 | 1.00 | 1.00 |
| persistence_reservation | 6 | 2 | 2 | 0 | 4 | 1.00 | 0.33 |
| pigment_complaint | 17 | 12 | 11 | 1 | 6 | 0.92 | 0.65 |
| shade_mismatch | 5 | 4 | 4 | 0 | 1 | 1.00 | 0.80 |
| skin_irritation_concern | 2 | 1 | 1 | 0 | 1 | 1.00 | 0.50 |
| tone_mismatch | 7 | 3 | 3 | 0 | 4 | 1.00 | 0.43 |
| value_complaint | 5 | 5 | 4 | 1 | 1 | 0.80 | 0.80 |

Note how the three gap-rule signals (`coupang_authenticity_concern`,
`persistence_reservation`, `skin_irritation_concern`) flip from P=0.00 in
the canonical view to P=1.00 in the historical view. Each has exactly one
labeled-reviewed + one labeled-draft row: reviewed-only excludes the draft,
so the one fired hit lands on an unlabeled row (FP); all-labels includes
the draft, and the same fired hit lands on a labeled row (TP).

---

## Guard: how to keep future iterations honest

1. Always invoke `scripts/eval_phase1_baseline.sh` for baseline
   measurements. Do not hand-copy its flags into inline commands.
2. Any flag change to that script counts as a spec change and MUST be
   committed together with a re-snapshot of this file.
3. When adding / tuning a signal: capture **pre** and **post** runs by
   calling the script twice (pre with the lexicon edit reverted, or with
   a temp signal_map that masks the new entry). Compare the two against
   this file, not against remembered numbers.
4. If you see a number in a prior conversation that disagrees with this
   file, the prior conversation is wrong (or used a different scope). Do
   not chase the remembered number.

## What to treat as authoritative vs stale

- **Authoritative (use these):** the canonical summary + per-signal table
  above. Re-measure by running the script; compare deltas to these
  numbers, not to anything else.
- **Informational (keep around for continuity):** the historical
  all-labels panel above.
- **Stale (ignore):** any floating number in past chat summaries that
  doesn't cite its scope — including the earlier "0.56 / 15 / pigment 0.92"
  set, now subsumed into the historical panel above.
