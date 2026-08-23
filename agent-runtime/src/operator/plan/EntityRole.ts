/**
 * Does this mention name a THING, or a KIND of thing?
 *
 * <b>Why this file exists.</b> On 2026-08-23 the Operator was asked to prioritise the inquiries that
 * needed answering. The planner declared an entity — `INQUIRY: "미답변 문의"` — and every scope check
 * downstream read that as *the seller is asking about one particular inquiry*. The entity axis is a
 * property of the whole plan (`scope/EvidenceScope.needScopeOf`), so the run then narrowed to ITEM
 * scope, refused the org-wide inbox it had just read because org evidence cannot answer an item
 * question, and ended with nothing to say about 69 inquiries it had counted correctly. Nothing was
 * wrong with the count, the tool, the gate or the goal. "미답변 문의" is not an inquiry — it is a
 * category of inquiries, and no id exists that could ever resolve it. Full record:
 * `docs/agent_real_validation_v1.md` §15.8 (A9) and the same defect on the product axis (C5), where
 * "상품별 최근 문제" sent `resolve_product("상품")` to look up a product called "상품".
 *
 * <b>The rule.</b> A mention is CATEGORY only when EVERY token in it is category vocabulary and at
 * least one of them is a category head. Anything else — one unknown token is enough — is an INSTANCE.
 *
 * <b>Why that direction and not the other.</b> The two errors are not symmetric:
 *
 *  - calling a category an INSTANCE over-narrows a run. Org evidence is refused, the answer is empty,
 *    and the seller is told less than the system knows. Quiet and useless.
 *  - calling an instance a CATEGORY widens it. "판도리 일체형 종이컵 수거함에 불만 있어?" would be
 *    answered from org-wide rows belonging to other products — which is the exact wrong answer this
 *    repository's entire scope layer exists to prevent (`scope/EvidenceScope.ts`).
 *
 * So the burden of proof is on CATEGORY, and an unrecognised word always means INSTANCE. A demonstrative
 * ("이 문의", "해당 상품") is therefore an instance by construction, because 이/그/저/해당 are deliberately
 * absent from every table below — they point at one thing the seller has in mind.
 *
 * <b>Why the role is computed here and not asked of the planner.</b> The same reason
 * `defaults/OperationalDefaults.ts` computes `appliedDefaults` rather than reading them off the model:
 * the planner that emitted `INQUIRY: "미답변 문의"` as an entity is precisely the planner that believed
 * it was one, and a self-label from it would have carried the defect verbatim. The role is a structural
 * property of the plan, assigned once at the wire boundary (`LlmInvestigationPlanner.toPlan`), and every
 * consumer — validator, runtime and scope gate — reads that one field. There is exactly one table, in
 * this file; `entitySemanticsAndScope.test.ts` asserts no second one exists.
 */
import type { EntityKind, EntityMention, InvestigationPlan, ResolvedEntity } from "./InvestigationPlan";

/**
 * What a mention refers to. Closed, and the two values are not interchangeable:
 *
 *  - `INSTANCE` — one particular product / inquiry / order the seller has in mind. It narrows the run's
 *    entity scope whether or not a tool manages to resolve it (A1: an unresolved instance is answered by
 *    nothing, never by org-wide rows).
 *  - `CATEGORY` — a kind of thing. It narrows nothing, is never handed to a resolver, and at most says
 *    which dimension an answer should be grouped along.
 */
export type EntityRole = "INSTANCE" | "CATEGORY";

/**
 * The head nouns that name a KIND of thing rather than one of them.
 *
 * Grouped by the kind they belong to for reading, and pooled when classifying: the planner's `kind` is
 * the field that was wrong in both live defects — A9 labelled a category `INQUIRY`, C5 labelled one
 * `PRODUCT` — so trusting it to decide which list applies would reintroduce the bug it caused.
 */
const CATEGORY_HEADS: Record<EntityKind, readonly string[]> = {
  PRODUCT: ["상품", "제품", "품목", "아이템", "상품군"],
  INQUIRY: ["문의", "문의사항", "질문", "고객문의", "cs"],
  ISSUE: ["리뷰", "후기", "이슈", "문제", "불만", "클레임", "컴플레인"],
  ORDER: ["주문", "발주", "배송", "주문건"],
  CHANNEL: ["채널", "판매채널", "마켓", "마켓플레이스", "스토어"],
  PERIOD: ["기간"],
};

/**
 * Words that QUALIFY a category without naming an individual.
 *
 * <b>Deliberately not a stopword list.</b> Each of these turns a head into a narrower category —
 * "미답변 문의", "반복 문의", "부정 리뷰" are three different categories and none of them is an
 * inquiry or a review. Demonstratives are absent on purpose: see the file docblock.
 */
const CATEGORY_MODIFIERS: readonly string[] = [
  "미답변", "답변", "미처리", "처리", "대기", "미확인", "확인", "응대", "대응", "접수",
  "반복", "재발", "누적", "신규", "새", "발생", "필요",
  "부정", "긍정", "악성", "낮은", "높은", "나쁜", "좋은",
  "최근", "오늘", "어제", "이번", "지난", "전체", "모든", "각", "주요", "우선", "중요",
  "관련", "일반", "기타",
];

/**
 * The predicate forms a category phrase actually arrives in.
 *
 * <b>Measured, not imagined.</b> The live planner does not write "미답변 문의" — over six samples of
 * one goal on 2026-08-24 it wrote "답변이 필요한 문의" and "오늘 처리해야 할 문의". Those are the same
 * category, and a table of bare nouns classifies neither. So a token also qualifies when it is a known
 * word inflected as a predicate ({@link QUALIFIER_STEMS} + {@link PREDICATE_ENDINGS}) or is one of the
 * contentless verb forms in {@link BARE_PREDICATES}.
 *
 * <b>Both halves are required, and that is the safety.</b> "일체형" ends in no predicate; "판도리"
 * begins with no stem. A product's name survives this rule intact, which is the direction that matters
 * — see the file docblock.
 */
const QUALIFIER_STEMS: readonly string[] = [...CATEGORY_MODIFIERS, "남", "밀", "쌓", "들어", "안", "못"];
const PREDICATE_ENDINGS: readonly string[] = [
  "한", "할", "하는", "해야", "해서", "된", "되는", "는", "은", "인", "온", "린", "있는", "없는",
];
/** Verb forms that carry no domain content at all — "할" in "처리해야 할 문의". */
const BARE_PREDICATES: readonly string[] = [
  "할", "한", "하는", "해야", "있는", "없는", "되는", "안", "못",
];

/** Particles and suffixes a mention carries into the plan. Stripped only when a stem survives. */
const SUFFIXES: readonly string[] = [
  "별로", "별", "들의", "들", "에서", "으로", "로", "의", "은", "는", "이", "가", "을", "를",
  "도", "만", "에", "와", "과", "랑",
];

/** Every category word, pooled — see {@link CATEGORY_HEADS}. */
const HEADS = new Set(Object.values(CATEGORY_HEADS).flat());
const MODIFIERS = new Set(CATEGORY_MODIFIERS);
const BARE = new Set(BARE_PREDICATES);

/**
 * INSTANCE or CATEGORY, from the mention's own words.
 *
 * @param kind carried for the caller's convenience and for future per-kind rules; the classification
 *     deliberately does not branch on it (see {@link CATEGORY_HEADS}).
 */
export function entityRoleOf(kind: EntityKind, mention: string): EntityRole {
  const tokens = tokensOf(mention);
  if (tokens.length === 0) {
    return "INSTANCE";
  }
  let sawHead = false;
  for (const token of tokens) {
    // The token as written first, and only then with a particle removed. Reversing the order costs
    // exactly the word "문의", whose last syllable IS a particle — stripping it blindly leaves "문",
    // which no table knows, and the whole A9 category then reads as a name.
    const words = splitCompound(token) ?? splitCompound(stripSuffix(token));
    if (words === null) {
      // One word nobody recognises is the seller naming something. That ends it.
      return "INSTANCE";
    }
    if (words.some((w) => HEADS.has(w))) {
      sawHead = true;
    }
  }
  // Modifiers alone name no category — "최근" as a PERIOD mention is the seller's own scope word, not a
  // kind of thing, and treating it as one would let this file decide the temporal axis.
  return sawHead ? "CATEGORY" : "INSTANCE";
}

/** A mention with its role decided. The only constructor — so no caller can assert a role by hand. */
export function mentionOf(kind: EntityKind, mention: string): EntityMention {
  return { kind, mention, role: entityRoleOf(kind, mention) };
}

export function isInstance(mention: EntityMention): boolean {
  return mention.role === "INSTANCE";
}

/**
 * The instance mentions of one kind — what a resolver may be handed, and nothing else.
 *
 * A category is never a resolver's input: `resolve_product("상품")` searches a catalogue for a product
 * named "상품", spends a tool call, and can only either find nothing or find something irrelevant (C5).
 */
export function instanceMentionsOf(plan: InvestigationPlan, kind: EntityKind): string[] {
  return plan.entities.unresolved.filter((e) => e.kind === kind && isInstance(e)).map((e) => e.mention);
}

/**
 * Did the seller name one particular thing of any of these kinds?
 *
 * <b>The single question the entity axis turns on</b> — asked identically by the validator (may this
 * plan reach what it named?), by the capability audit (is this need anchored?) and by the scope gate
 * (what is this need about?). One implementation, so those three cannot drift into different readings
 * of the same sentence.
 *
 * A resolved entity always counts: it exists because a TOOL matched it to a row, which is what being an
 * instance means.
 */
export function namesInstance(
  plan: InvestigationPlan,
  kinds: readonly EntityKind[],
  resolved: readonly ResolvedEntity[] = plan.entities.resolved,
): boolean {
  return plan.entities.unresolved.some((e) => kinds.includes(e.kind) && isInstance(e))
    || resolved.some((r) => kinds.includes(r.kind));
}

/**
 * The particles that make a head noun the ANSWER the seller is asking for, rather than a word
 * qualifying something they already named.
 *
 * <b>This is the whole difference between "상품별 문제" and "판도리 종이컵 수거함 상품의 문제".</b> The
 * same head noun appears in both; in the first it names the axis, in the second it hangs off a product
 * the seller has already identified. Korean marks that difference with the particle, so the particle is
 * what is read — and the genitive 의 and the locative 에 are deliberately absent, which is why
 * "상품에 문제 있어?" still asks which product rather than answering about all of them.
 */
const AXIS_PARTICLES: readonly string[] = ["별", "별로", "이", "가", "을", "를", "은", "는", "도", "들"];

/**
 * Does this text contain a word naming the KIND {@code kind} — "상품", "문의", "리뷰"?
 *
 * <b>Per-kind here, pooled in {@link entityRoleOf}, and the difference is deliberate.</b> The role
 * question is "did the seller name one thing or a kind of thing", and the planner's `kind` field was
 * wrong in both live defects, so it is not trusted there. This question is "WHICH axis" — the kind IS
 * the answer, so it must be asked per kind. Same table either way: there is exactly one.
 */
export function namesCategoryHead(kind: EntityKind, text: string): boolean {
  const heads = new Set<string>(CATEGORY_HEADS[kind]);
  for (const token of tokensOf(text)) {
    const words = splitCompound(token) ?? splitCompound(stripSuffix(token));
    if (words?.some((w) => heads.has(w))) {
      return true;
    }
  }
  return false;
}

/**
 * Does the seller's own sentence ask for the {@code kind} axis — "상품별", "…있는 상품을"?
 *
 * Stricter than {@link namesCategoryHead} by exactly one thing: the head must wear an
 * {@link AXIS_PARTICLES axis particle}. A bare head, a genitive or a locative is not an axis request,
 * and the failure direction is toward NOT grouping — an answer that groups when nobody asked has
 * changed the question.
 */
export function asksForAxis(kind: EntityKind, text: string): boolean {
  const heads = CATEGORY_HEADS[kind];
  for (const token of tokensOf(text)) {
    for (const head of heads) {
      if (!token.startsWith(head) || token.length === head.length) {
        continue;
      }
      if (AXIS_PARTICLES.includes(token.slice(head.length))) {
        return true;
      }
    }
  }
  return false;
}

/** The tokens of a phrase, lowercased. One tokenizer, so a mention and a goal are read the same way. */
function tokensOf(text: string): string[] {
  return text.trim().toLowerCase().split(/[\s,·/]+/).filter((t) => t.length > 0);
}

/**
 * Trailing particle removed, when something is left. "상품별" → "상품"; "이" stays "이".
 *
 * Only ever consulted after the token itself was not recognised — see {@link entityRoleOf}.
 */
function stripSuffix(token: string): string {
  for (const suffix of SUFFIXES) {
    if (token.length > suffix.length && token.endsWith(suffix)) {
      return token.slice(0, token.length - suffix.length);
    }
  }
  return token;
}

/**
 * One token into the category words it is made of, or `null` when it is not made of them.
 *
 * Korean compounds a category phrase with or without the space — "미답변 문의" and "미답변문의" are the
 * same category — so a rule that only split on whitespace would classify one of them and not the other.
 * Bounded to modifier+head: a longer chain would start guessing at words inside a product's name.
 */
function splitCompound(word: string): string[] | null {
  if (HEADS.has(word) || MODIFIERS.has(word) || qualifies(word)) {
    return [word];
  }
  for (const head of HEADS) {
    if (word.length > head.length && word.endsWith(head)) {
      const prefix = word.slice(0, word.length - head.length);
      if (MODIFIERS.has(prefix)) {
        return [prefix, head];
      }
    }
  }
  return null;
}

/**
 * Is this token a known word wearing a predicate ending, or a contentless verb form?
 *
 * See {@link QUALIFIER_STEMS} for why the rule needs both ends and what that costs.
 */
function qualifies(word: string): boolean {
  if (BARE.has(word)) {
    return true;
  }
  return PREDICATE_ENDINGS.some((e) => word.length > e.length && word.endsWith(e))
    && QUALIFIER_STEMS.some((stem) => word.length > stem.length && word.startsWith(stem));
}
