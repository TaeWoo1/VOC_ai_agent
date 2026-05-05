# public_instagram_cardnews — Output Spec (v0, draft)

Status: **spec only**. No code in this pass. The companion strategy lives at `docs/review_ops_brand20_pipeline.md §12`. This document is the contract that a future `cardnews_public_instagram.py` (and a future `cardnews_safety_validator_public.py`) must satisfy.

---

## 1. Purpose and audience

### Purpose
A recurring Instagram surface that demonstrates **how review/VOC signals translate into brand actions**. The unit of value is the *method* (signal → action mapping), not the *verdict* on any specific brand or SKU.

### Audience
Three concentric rings, in priority order:

| Ring | Who | What they want from a single carousel |
|---|---|---|
| Primary | Brand operators (BM/MD/PM) at small-to-mid Korean cosmetics brands | A repeatable interpretive frame they can apply to their own reviews tomorrow |
| Secondary | Agencies / consultancies adjacent to those brands | Evidence that we read review data more usefully than the dashboard tools they currently use |
| Tertiary | Inbound talent / partner candidates | A demonstration that this team translates VOC into product action, not into deck filler |

Posts are written for the primary ring. The secondary and tertiary rings are observation-only — never optimize wording for them.

### What the channel does NOT do
- Brand reputation calls.
- Product reviews of products.
- Comparative analysis between named brands.
- Newsworthy commentary on industry trends ("이번 달 화장품 트렌드는…").

---

## 2. Difference from `private_brand_cardnews`

| Dimension | `private_brand_cardnews` (today's `buyer_journey_cardnews`) | `public_instagram_cardnews` (this spec) |
|---|---|---|
| Input | A single SKU's `analysis_report.json` | A category + archetype + (optional) composited signals from N completed runs |
| Brand naming | Allowed per per-engagement opt-in | **Forbidden by default**; explicit override is a separate workflow |
| SKU naming | Allowed | **Forbidden** |
| Verbatim quotes | Sanitized + hedge-ended | **Forbidden** even when sanitized |
| review_id surface | Audit-only (`audit.evidence_review_id_truncated`) | **Forbidden everywhere**, including audit fields |
| Channel mention (Olive Young / Coupang / etc.) | Allowed in operator-facing context | **Forbidden** |
| Output location | `outputs/<run_dir>/cardnews/<lang>/` | `outputs/public_instagram/<YYYY-MM-DD>_<post-slug>/` (decoupled from per-SKU run_dirs) |
| Distribution | Private 1:1 to a brand operator | Public Instagram feed |
| Approval | Project-internal review | Per-post human approval gate (mandatory; no auto-publish) |
| Schema root key | `analysis_report` (carries `product`, `corpus`, attributes…) | `public_instagram_cardnews` (carries `category`, `archetype`, slides…) — see §10 |
| Safety validator | `cardnews/safety_validator.py` (existing) | `cardnews_safety_validator_public.py` (NEW; stricter — see §11) |

The two paths must never share a runtime state. A future `cardnews/render.py --mode {private_brand|public_instagram}` flag is acceptable as long as it routes to a different validator and a different output convention; sharing templates between modes is **not** acceptable.

---

## 3. Five content categories

Each post belongs to exactly one category. The category tag is rendered visibly in the carousel footer and is also recorded in the JSON's `category` field.

| Code | KO label | Frame |
|---|---|---|
| `interpretation_note` | 리뷰 해석 노트 | "한 종류의 리뷰가 실제로 무엇을 말하고 있는지를 풀어 읽기" |
| `internal_question` | 리뷰 → 내부 질문 | "이 리뷰를 받았다면 OEM/PM에게 어떤 질문이 후속으로 가야 하는가" |
| `landing_signal` | 상세페이지 보완 신호 | "리뷰가 반복적으로 짚는 지점은 종종 상세페이지가 비어 있는 자리" |
| `report_anatomy` | VOC 리포트 구성법 | "리뷰가 모이면 어떤 보고서가 가능한가" — 메타-콘텐츠 |
| `composite_case` | 익명/재구성 케이스 | "여러 SKU의 패턴을 합성해 한 사이클을 보여주는 case-study" |

When a draft post does not fit any of these five, it almost certainly belongs to private cardnews instead — do not invent a sixth public category without a strategy revision (`docs/review_ops_brand20_pipeline.md §12.5`).

---

## 4. Page-structure templates per category

All carousels open on a hook slide and close on a category-tag/disclaimer slide. The middle is fixed per category. Every body slide ends in a hedge form (`{후보, 가능성, 검토, 권장, 확인}` or "이어질 수 있습니다") — same contract as the seller PDF and review_ops report.

### 4.1 `interpretation_note` — 5 slides

| # | Role | Content shape |
|---|---|---|
| 1 | Hook | "이런 리뷰, 어떻게 읽으세요?" + one-line generic review pattern (no brand) |
| 2 | Surface read | The obvious / fast read — usually one frame. State it plainly, not dismissively |
| 3 | Deeper read | The frame the surface read misses. 2-3 sub-signals it actually carries |
| 4 | Internal-check candidate | "그래서 내부에서 무엇을 확인할 후보가 됩니다" — bullet list of 2-3 hedge-ended check points |
| 5 | Footer | Category tag (`리뷰 해석 노트`) + reconstruction disclaimer |

### 4.2 `internal_question` — 6 slides

| # | Role | Content shape |
|---|---|---|
| 1 | Hook | "이 리뷰를 받으면 누구에게 무엇을 묻나요?" |
| 2 | Generic review setup | Composited review pattern (no brand, no SKU). 1-2 sentences |
| 3 | The obvious question | The first question that comes to mind — and why it usually doesn't move anything |
| 4 | The better question | A reframed question that actually uncovers an internal action |
| 5 | Question library | 3-5 example follow-up questions for similar review types |
| 6 | Footer | Category tag + reconstruction disclaimer |

### 4.3 `landing_signal` — 5 slides

| # | Role | Content shape |
|---|---|---|
| 1 | Hook | "이 리뷰가 반복되면, 상세페이지가 빠뜨린 자리가 있어요" |
| 2 | Generic review pattern | Composited review (no brand) — what reviewers keep saying |
| 3 | Detail-page baseline | What this category's detail pages typically already say |
| 4 | The gap + candidate copy | What's missing + 1-2 candidate sentences/sections to add (hedge-ended) |
| 5 | Footer | Category tag + reconstruction disclaimer |

### 4.4 `report_anatomy` — 6 slides

| # | Role | Content shape |
|---|---|---|
| 1 | Hook | "VOC 리포트는 왜 안 쓰이나요?" |
| 2 | Common failure shape | The "정량 → 정성 → 권장" deck that ends up unread. State it, don't strawman it |
| 3 | Better shape — sections | A list of sections that map to operator decisions (e.g. "활용 가능 자산 / 갱신 후보 / 리스크 후보 / 인사이트") |
| 4 | What each section answers | One question per section, in operator language |
| 5 | Workflow integration | How this report fits in a Mon/Wed/Fri cadence, who reads which section |
| 6 | Footer | Category tag (no reconstruction disclaimer needed; this is meta-content) |

### 4.5 `composite_case` — 7 slides

| # | Role | Content shape |
|---|---|---|
| 1 | Hook | "한 카테고리에서 1년치 리뷰가 모이면 이런 그림이 나옵니다" + category archetype name |
| 2 | Setup | Sample size scale ("≈ N건 규모") + reconstruction disclaimer up-front |
| 3 | Pattern A — strength | Composited positive cluster — what reviewers consistently liked |
| 4 | Pattern B — split | Composited divided cluster — same product behavior read two opposite ways depending on user context |
| 5 | Pattern C — caution | Composited negative cluster — and the *internal* question it raised |
| 6 | What changed | Generic candidate actions the case suggests (hedge-ended) |
| 7 | Footer | Category tag + reconstruction disclaimer |

### 4.6 Slide-element vocabulary

These are the canonical slide-element types every category template draws from. The future generator should produce these as discriminated-union variants under `slides[*].type`.

| Type | Used by | Constraints |
|---|---|---|
| `hook` | every category, slide 1 | One question or one assertion. ≤ 30 자 headline + ≤ 60 자 subline |
| `pattern_setup` | 4.1 / 4.2 / 4.3 / 4.5 | Generic review pattern. Must NOT be a single verbatim quote; phrase as paraphrased aggregate |
| `surface_read` / `deeper_read` | 4.1 | Side-by-side or A/B framing. Hedge endings on `deeper_read` |
| `question_pair` | 4.2 | One "obvious" question + one "better" question. Both visible |
| `question_library` | 4.2 | List of 3–5 hedge-ended questions, no brand/SKU placeholders |
| `gap_diagram` | 4.3 | "리뷰는 X · 상세페이지는 Y · 차이는 Z" three-row layout |
| `candidate_copy` | 4.3 | Suggested sentence(s) for the detail page; rendered in a quote-style block but explicitly labelled `예시 문구 후보` |
| `report_section_list` | 4.4 | Ordered section list with one-line explanation each |
| `workflow_grid` | 4.4 | 3-column or 3-row grid mapping cadence × section × consumer |
| `composite_pattern_card` | 4.5 | Pattern type (strength / split / caution) + 2-3 sentence summary |
| `category_tag` | every category, last slide | Footer chip with category KO label |
| `reconstruction_disclaimer` | every category EXCEPT `report_anatomy` | "실제 리뷰 흐름을 토대로 재구성한 사례입니다 · 특정 브랜드/제품과는 무관합니다" |

---

## 5. Copy tone rules

### Voice
**단정하지 않지만 실무적으로 유용한 분석가.** Not a coach. Not a critic. Not a journalist. The reader should feel they've been handed a tool, not a take.

### Three rules that override every other style choice

1. **문제 확정이 아니라 검토 후보.** Every claim about cause / fix / risk ends in `{후보, 가능성, 검토, 권장, 확인}` or `이어질 수 있습니다`. Never `~ 때문입니다`, `~ 해야 합니다`, `~ 결함입니다`.
2. **리뷰를 액션으로 번역.** A post is not finished at "이런 리뷰가 있어요". It is finished at "그래서 내부에서 무엇을 확인할 후보가 됩니다". The translation step is the deliverable.
3. **메서드 우선, 사례 보조.** When a real-run signal is reused (per §9), the post must read so that removing the example would still leave a usable method. The example is illustrative, not load-bearing.

### Tone-checklist before publishing

- [ ] No imperative verbs ("~해야 합니다", "~필요합니다") — replaced with hedge form.
- [ ] No definite causal claims ("원인은 ~입니다") — replaced with possibility ("가능성이 있습니다").
- [ ] No superlatives ("최고", "최악", "가장 큰 문제") — replaced with rank-bounded language ("자주 등장하는 패턴 중 하나").
- [ ] No timeline urgency ("지금 당장", "더 늦기 전에") — public Instagram is not a sales surface.
- [ ] No second-person directives ("당신의 브랜드는…") — replaced with category framing ("이 카테고리에서는…").

---

## 6. Forbidden elements (hard fails — validator must reject)

A draft that contains any of the following is **not publishable** and must fail the public safety validator (§11). No exceptions in v0.

| # | Element | Why forbidden | Detection signal |
|---|---|---|---|
| 1 | Brand names (Korean or English) | Brand attribution in a public negative-context surface poisons future outreach | Match against a curated brand-name lexicon (KO + EN); fuzzy-match for romanization variants |
| 2 | SKU codes | Even a single A0… string is recoverable to a specific product | Regex `A0\d{12}` |
| 3 | Verbatim review quotes | Quotes are seldom plausibly anonymous when paired with category + tone | Long-substring overlap with any review in the source DB above a length threshold |
| 4 | review_id (any form) | Internal audit identifier, public surface should never see it | Regex `[0-9a-f]{12,}` (full 16-hex and the 12-hex truncation used in audit fields) |
| 5 | Scraped source/channel names | "올리브영 리뷰 분석" / "Olive Young VOC" / "쿠팡 리뷰" framing implies we have privileged data on a specific commerce channel | Match `올리브영|oliveyoung|쿠팡|coupang|네이버 리뷰|naver review` (case-insensitive) |
| 6 | Defect/efficacy/medical claims | Same `PLANNER_MEDICAL_BANNED_KO` list that gates the existing safety validator (`치료`, `완치`, `의학적`, etc.) | Reuse existing lexicon |
| 7 | Raw review counts as a brand-quality signal | "N건의 부정 리뷰" framing | Pattern: digit + `건` + `(부정\|클레임\|불만\|악평)` proximity |
| 8 | Specific store/cafe/community attribution | "맘카페에서…", "다이소에서…" — implies sourced surveillance | Curated channel-name lexicon |

Forbidden elements are **not** removed from drafts by sanitization — they are reasons to reject the draft and rewrite. Auto-substitution is explicitly out of scope; a human author must make the rephrasing decision.

---

## 7. Safe language examples

These are the rephrased forms a draft should reach **before** validator review.

| Frame | Safe wording |
|---|---|
| Negative pattern intro | "이 카테고리에서는 ◯◯에 대한 부정 톤이 반복되는 경우가 있습니다." |
| Internal-check candidate | "내부에서는 ◯◯ 사양/공정 변동 여부를 확인 후보로 두는 게 자연스럽습니다." |
| Detail-page gap | "상세페이지가 △△ 사용 상황을 명시하지 않는 경우, 이 후기 패턴이 더 자주 누적될 가능성이 있습니다." |
| Question library | "OEM에 보낼 후속 질문 후보:\n  · 최근 N개월 ◯◯ 부자재 로트 변경 여부 확인 가능할까요?\n  · △△ 옵션의 사용 가이드 문구가 변경된 적이 있나요?" |
| Composite case open | "여러 SKU에서 반복적으로 관찰되는 패턴을 한 흐름으로 재구성했습니다 · 특정 브랜드/제품과는 무관합니다." |
| Sample-size disclosure | "≈ 수천 건 규모의 후기에서 반복적으로 등장한 카테고리-수준 신호입니다." (정확 수치 비공개) |

---

## 8. Risky language examples

For each, the rephrase target is in §7. Validator should treat each row as a hard fail.

| ⚠ Risky wording | Why it fails |
|---|---|
| "OO쿠션 사용자들이 두께감을 자주 지적합니다" | Brand naming + verdict framing |
| "리뷰 1,243건 분석 결과 부정 비율이 높습니다" | Raw count + brand-quality signal |
| "올리브영 리뷰를 통해 본 ◯◯브랜드의 약점은…" | Source channel mention + brand attribution |
| (verbatim review quote) "진짜 두껍고 답답해요" | Verbatim quote |
| "이 제품은 ◯◯ 결함이 있는 것으로 보입니다" | Defect framing + 단정 동사 |
| "재구매율이 떨어지고 있습니다" (without hedge, with brand context) | Definite trend claim |
| "지금 당장 OEM에 확인 요청하셔야 합니다" | Imperative + urgency |
| "맘카페에서 흔히 나오는 불만은…" | Channel attribution + pejorative aggregation |

---

## 9. Data abstraction rules

When a public post draws on signals from real completed runs (per §12.8 of the strategy doc), the abstraction transforms below are **mandatory** before draft handoff to the safety validator.

### 9.1 Default mode — category-level only

A post is by default written from **category archetype + accumulated method knowledge**, with no per-run input. This mode is always safe and should be the dominant production path.

### 9.2 Composited mode — when real-run signals are reused

Permitted only when **all** of the following hold:

1. **Source breadth.** Signal is composited from `N ≥ 3` distinct completed runs in the same category profile (e.g. ≥3 cushion runs, ≥3 toner-pad runs).
2. **Topic-level abstraction.** The signal is reduced to one of the 12 canonical Phase 2E attributes (`pigmentation`, `persistence`, `packaging_container`, etc.) — not to a sub-keyword cluster.
3. **No quote pass-through.** Zero substring of the source DB review text appears in the output, even rephrased — phrasing is rewritten from the abstracted attribute, not from any quote.
4. **No counts pass-through.** Output never carries the absolute count of reviews; only category-typical scale words ("자주 반복되는", "수천 건 규모", "일관되게 관찰되는").
5. **Audit list.** The composited `run_id` set is recorded in the JSON `source_policy.composited_from_run_ids` field for internal audit but **never rendered** to the carousel.

### 9.3 Recovery test (the SKU-recoverability check)

Before a composited post is approved, the human reviewer must answer: *"Could a reader who has seen the Brand-20 list infer which SKU(s) this is about?"*

If the answer is "probably yes" the post fails. If the answer is "only by guessing" the post passes this gate. There is no precision-tunable threshold — recoverability is a binary judgment by the human approver.

---

## 10. Output schema proposal — `public_instagram_cardnews.json`

A single self-contained JSON file per post. Stored at `outputs/public_instagram/<YYYY-MM-DD>_<post-slug>/spec.json`. The file must validate against the schema below; the validator (§11) is run on the parsed dict, not on the raw string.

```jsonc
{
  "schema_version": "public_instagram_cardnews.v0",
  "post_id": "2026-05-12_interp-cushion-thickness",
  "category": "interpretation_note",        // one of: interpretation_note |
                                            //         internal_question |
                                            //         landing_signal |
                                            //         report_anatomy |
                                            //         composite_case
  "archetype": "base_makeup.cushion",       // category profile from the 7 cosmetics
                                            // profiles + leaf descriptor; never a SKU
  "title": "두껍다는 리뷰는 정말 두께 얘기일까요?",  // ≤ 30 자
  "subtitle": "쿠션 카테고리에서 자주 반복되는 톤",   // ≤ 60 자
  "language": "ko",
  "slides": [
    {
      "index": 1,
      "type": "hook",
      "headline": "두껍다는 리뷰는 정말 두께 얘기일까요?",
      "subline": "쿠션 카테고리에서 반복되는 한 가지 톤을 풀어봅니다."
    },
    {
      "index": 2,
      "type": "surface_read",
      "headline": "표면적으로 읽으면",
      "body": "제품이 무겁거나 도포가 두꺼워 답답하게 느껴진다는 의견."
    },
    {
      "index": 3,
      "type": "deeper_read",
      "headline": "조금 더 들어가 보면",
      "bullets": [
        "도포 직후 느껴지는 점도/유분에 대한 톤일 가능성이 있습니다.",
        "수정화장 시 누적된 레이어에 대한 톤일 가능성도 함께 섞여 있어 보입니다.",
        "기획/단품 옵션 차이가 사용감 톤에 영향을 줄 가능성을 검토 후보로 둘 수 있습니다."
      ]
    },
    {
      "index": 4,
      "type": "internal_check_candidate",
      "headline": "내부에서 확인 후보로 둘만한 질문",
      "bullets": [
        "최근 분기 베이스 처방 변동 여부 확인 권장.",
        "옵션별(기획/단품) 동일 처방인지 OEM에 확인 후보.",
        "수정화장 가이드가 상세페이지에 명시돼 있는지 점검 권장."
      ]
    },
    {
      "index": 5,
      "type": "category_tag",
      "category_label_ko": "리뷰 해석 노트",
      "reconstruction_disclaimer_ko":
        "실제 리뷰 흐름을 토대로 재구성한 사례입니다 · 특정 브랜드/제품과는 무관합니다."
    }
  ],
  "principles_applied": [
    "method_first",
    "signal_to_action_translation",
    "hedge_endings",
    "no_brand_naming",
    "no_verbatim_quotes"
  ],
  "source_policy": {
    "mode": "composited",                    // category_only | composited
    "composited_from_run_ids": [             // empty when mode=category_only;
      "abc123def4567890",                    // never rendered to the carousel
      "...",
      "..."
    ],
    "min_source_count": 3,                   // §9.2 rule 1
    "abstraction_level": "phase2e_attribute" // §9.2 rule 2
  },
  "human_approval_required": true,
  "human_approval": {                        // populated by the approval workflow
    "approved_by": null,                     // operator id / email
    "approved_at": null,                     // ISO 8601
    "approval_notes": null,                  // optional rationale, esp. for edge cases
    "recoverability_check_passed": null      // §9.3 binary judgment
  },
  "generator_metadata": {
    "generator": "cardnews_public_instagram@v0",
    "generated_at": "2026-05-12T03:14:00Z",
    "validator_passed": null,                // populated by safety validator
    "validator_version": "cardnews_safety_validator_public@v0"
  },
  "render_targets": ["instagram_carousel_4x5"]
}
```

### Field rules

- `schema_version` is a literal string; bumping it requires migration of every prior post's JSON to the new shape.
- `category` is closed enum (5 values from §3). Validator rejects unknown values.
- `archetype` is `<profile_id>.<leaf_descriptor>`. `profile_id` MUST be one of the 7 existing cosmetics profiles. `leaf_descriptor` is a free-form lowercase token; it must NOT carry a brand or SKU name.
- `slides[*].type` is closed enum from §4.6. Validator rejects unknown types.
- `slides[*]` body fields (`headline`, `subline`, `body`, `bullets[*]`) all run through the public safety validator. A single failure on any field rejects the post.
- `principles_applied` is informational; it does not alter validator behavior. Use as a self-reporting field that surfaces in the post's audit trail.
- `source_policy.composited_from_run_ids` is internal audit only — the renderer MUST NOT emit it into any rendered slide.
- `human_approval.approved_by` MUST be non-null before the renderer accepts the post for PNG output. (Renderer can refuse to render if approval is missing.)

### Forbidden top-level fields

The schema deliberately omits anything resembling per-SKU context. A draft that tries to add any of the following keys is malformed:

- `product`, `sku`, `brand`, `goods_no`, `source_url`
- `corpus`, `metrics`, `attributes` (the per-SKU shapes)
- `evidence_review_ids`, `quote_review_ids`
- `analysis_report_path`, `run_dir`

---

## 11. Safety validator requirements

A new module `cardnews_safety_validator_public.py` (NEW; not implemented in this pass) extends the existing safety patterns with a public-mode profile. Reuse where possible; deviate only where stricter.

### 11.1 Reused (from `cardnews/safety_validator.py`)

- `BANNED_FRAMINGS_KO` — the existing buyer-facing bans (clickbait, brand-attack, consumer-as-ignorant) all apply.
- `PLANNER_MEDICAL_BANNED_KO` — medical/efficacy claim bans apply unchanged.
- Hedge-ending check — every body line ending in non-hedge form is rejected.

### 11.2 New (public-only)

| Check | Rule | Failure behavior |
|---|---|---|
| Brand-name detection | Match against curated `BRAND_LEXICON_KO_EN` list. Fuzzy match for romanization variants (편집거리 ≤ 2 against the canonical form) | Hard fail |
| SKU detection | Regex `\bA0\d{12}\b` anywhere in any string field | Hard fail |
| review_id detection | Regex `\b[0-9a-f]{12,}\b` (covers both 16-hex full and 12-hex truncated forms) | Hard fail |
| Verbatim-quote detection | For each body line ≥ 12 chars, check for substring overlap with any review in the source DB above a length threshold (e.g. ≥ 8 contiguous chars) | Hard fail |
| Channel-name detection | Match against `SOURCE_CHANNEL_LEXICON_KO_EN` (`올리브영`, `oliveyoung`, `쿠팡`, `coupang`, `네이버 리뷰`, `naver review`, etc., case-insensitive) | Hard fail |
| Raw-count brand-signal detection | Pattern: digit + `건` within 8 자 proximity of `(부정\|클레임\|불만\|악평)` | Hard fail |
| Imperative/directive detection | Reuse the existing `_PUBLIC_DIRECTIVE_BAN_RES` from `safety.py` if available; otherwise port the same ban list | Hard fail |
| `source_policy.mode = "composited"` ⇒ require `len(composited_from_run_ids) ≥ source_policy.min_source_count` and `min_source_count ≥ 3` | Schema-level | Hard fail |
| `human_approval.approved_by` required before PNG render | Render-time gate | Block render |

### 11.3 Validator output contract

The validator returns a structured result, not a boolean. Mirror the existing `OperatorReportSafetyError` shape:

```python
@dataclass
class PublicSafetyResult:
    passed: bool
    violations: list[PublicSafetyViolation]   # field path, rule id, matched substring

@dataclass
class PublicSafetyViolation:
    field_path: str        # e.g. "slides[3].bullets[1]"
    rule_id: str           # e.g. "brand_name" | "sku" | "review_id" | "verbatim_quote"
    matched: str           # the offending substring; truncate at 60 chars in logs
    suggested_action: str  # short hedge ("rephrase as category-level signal", etc.)
```

The validator should run as a precondition to the renderer and as a precondition to the approval workflow. A post that fails validation cannot be approved (the approval UI should refuse to record `approved_by` while violations are non-empty).

---

## 12. First 15 post ideas

Three per category. All deliberately category-level so they can be drafted today against existing review_ops patterns without composited inputs (per §9.1). These are seeds — the actual draft text + slide content is a separate authoring pass.

### `interpretation_note` (3)

| # | Working title | Archetype | Hook |
|---|---|---|---|
| I-1 | 두껍다는 리뷰는 정말 두께 얘기일까요? | base_makeup.cushion | 톤 vs 컨텍스트의 분리 |
| I-2 | "끈적해요"가 끈적이지 않을 수도 있는 이유 | lip_makeup.tint | 점도 vs 잔여감 vs 발색 지속 |
| I-3 | 보풀 후기는 종종 패드 얘기가 아닙니다 | skincare_pad.toner_pad | 원단 vs 사용 방법 vs 함유 에센스 |

### `internal_question` (3)

| # | Working title | Archetype | Hook |
|---|---|---|---|
| Q-1 | 펌프 누수 후기를 OEM에게 어떻게 묻나요? | skincare.serum_pump | 부자재 로트 / 인서트 제조사 / 출고 직후 vs 사용 중 분리 |
| Q-2 | "향이 변했어요"가 들어왔을 때, 첫 질문 | sunscreen.spf_general | 처방 변경 / 보존 조건 / 동일 옵션 일관성 |
| Q-3 | 트러블 후기 한 줄을 5개 질문으로 바꾸기 | skincare.cleanser_general | 자극원 후보 분리 — 계면활성제 / pH / 잔류 / 사용 빈도 / 피부 컨텍스트 |

### `landing_signal` (3)

| # | Working title | Archetype | Hook |
|---|---|---|---|
| L-1 | 사용 방법이 빠진 자리에서 후기는 갈립니다 | skincare_pad.toner_pad | 닦토 vs 적용 방식 명시 부재 |
| L-2 | "백탁 없음"을 말하지 않는 선크림의 후기 패턴 | sunscreen.spf_general | 무기자차/유기자차 표기와 사용감 후기의 매핑 |
| L-3 | 옵션별 가이드가 비어 있을 때, 부정 톤이 누적되는 자리 | base_makeup.cushion | 기획/단품 사용감 차이 미고지 |

### `report_anatomy` (3)

| # | Working title | Hook |
|---|---|---|
| R-1 | VOC 리포트는 왜 안 쓰이나요? — 4개의 단절 지점 | "정량→정성→권장" 구조의 실패 모드 |
| R-2 | "활용 / 갱신 / 리스크 / 인사이트" — 운영자가 실제로 분류하는 4통 | 자산 분류 메타-콘텐츠 |
| R-3 | 답글 초안과 OEM 질문 초안이 같이 있는 보고서 | 액션 통합형 리포트 구조 |

### `composite_case` (3)

| # | Working title | Archetype | Hook |
|---|---|---|---|
| C-1 | 한 카테고리에서 1년치 리뷰가 모이면 — 쿠션 사례 | base_makeup.cushion | 강점/분기/주의 3개 패턴 + 후속 질문 |
| C-2 | 패드 카테고리의 "양면성" — 같은 행동, 두 갈래 후기 | skincare_pad.general | 강점이 약점이 되는 사용 컨텍스트 |
| C-3 | 클렌저의 "두 번째 세안" 분기 — 후기가 가르는 자리 | cleansing.oil_or_balm | 사용 방법 가이드와 후기 톤의 상호작용 |

### Production cadence note

A reasonable v0 publication cadence is **2 posts/week**, biased toward `interpretation_note` and `internal_question` early because both can be drafted from existing review_ops patterns without composited inputs. `composite_case` posts require the §9.2 multi-run abstraction work and should be batched once the source pool is large enough (the Brand-20 pilot creates that pool).

---

## Out-of-scope (intentionally deferred)

- Implementation of `cardnews_public_instagram.py` — code lands in a later ticket.
- Implementation of `cardnews_safety_validator_public.py` — also later.
- Brand-name lexicon curation — separate authoring task; first-pass list lives outside this spec.
- Verbatim-quote detection's substring-length threshold tuning — empirical, set when validator implementation begins.
- The approval workflow UI — a future "publish gate" tool. v0 can be a manual review + a CLI `mark-approved` command; spec does not bind the UX.
- English-language variant — `language` field exists but EN-template authoring is its own pass.
- `cardnews/render.py --mode {private_brand|public_instagram}` flag — the routing layer is named in §12.8 of the strategy doc but is not specified here. Render-side spec is its own document.
