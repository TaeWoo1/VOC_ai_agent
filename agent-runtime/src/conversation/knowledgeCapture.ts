/**
 * Knowledge Capture v1 (2026-08-30) — the deterministic half of "ask the seller for the missing basis".
 *
 * Everything in this module is a pure function over values the backend already computed or the seller
 * already typed. It decides WHETHER a gap is capturable (from the composer's own per-lane verdict,
 * never from a sentence), WHAT to ask (a closed template per scope × topic — no model writes the
 * question), whether the seller's next sentence IS an answer (closed cancel / question / command cues,
 * so a question is answered and a 「취소」 cancels), and whether an existing rule makes the candidate a
 * duplicate or a contradiction (exact/normalized body, same title, or the same unit with a different
 * figure — the smallest fence that catches 「1~2일」 vs 「2~3일」 without a model judging policy).
 *
 * <b>The content is the seller's sentence.</b> Normalization here is whitespace and length only. Nothing
 * adds a number, completes a policy, or mixes a customer's words in; a model never sees the candidate.
 */
import { createHash } from "node:crypto";
import type { KnowledgeGapView, RetrievalOutcome } from "../spring/types";
import type { KnowledgeCaptureScope, PendingKnowledgeCapture, ToneHint } from "./contract";
import { ordinalSelectionOf, toneIntentOf } from "./styleIntent";

/* ───────────── topics ───────────── */

/** `KnowledgeTopic` → the org rule type the settings screen files it under, and the seller's word for it. */
const ORG_TOPIC: Record<string, { readonly knowledgeType: string; readonly label: string }> = {
  SHIPPING: { knowledgeType: "SHIPPING_POLICY", label: "배송" },
  EXCHANGE_RETURN: { knowledgeType: "EXCHANGE_REFUND_POLICY", label: "교환·반품·환불" },
  CANCELLATION: { knowledgeType: "CANCELLATION_POLICY", label: "주문 취소" },
  PAYMENT: { knowledgeType: "PAYMENT_POLICY", label: "결제" },
  TAX_INVOICE: { knowledgeType: "TAX_INVOICE", label: "세금계산서" },
  CASH_RECEIPT: { knowledgeType: "CASH_RECEIPT", label: "현금영수증" },
};

/** The org topic behind the seller's word for it (the label the POLICY lane stamps on a gap), or null. */
export function orgTopicOf(label: string): { readonly topic: string; readonly knowledgeType: string; readonly label: string } | null {
  const hit = Object.entries(ORG_TOPIC).find(([, t]) => t.label === label.trim());
  return hit ? { topic: hit[0], ...hit[1] } : null;
}

const MISSING: ReadonlySet<RetrievalOutcome> = new Set(["ABSENT", "NO_RELEVANT_EVIDENCE"]);

export const SETTINGS_POLICIES = "/settings/policies";

export interface CaptureContext {
  readonly inquiryId: string | null;
  readonly workItemId: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly tone: ToneHint | null;
}

/** The gap as opened — everything but the ids the service mints (captureId, turnId, askedAt). */
export type OpenedGap = Omit<PendingKnowledgeCapture, "captureId" | "turnId" | "askedAt" | "state" | "candidate" | "resume">;

/**
 * Whether this draft's verdict is a gap the seller can close by stating ONE fact, and which one.
 *
 * - ORG: the question names one operating topic and the rules lane is ABSENT — or a miss over rules
 *   that declare nothing about that topic, which is absence for that topic. A rule that EXISTS and does
 *   not apply (NOT_APPLICABLE) is never asked for again: that is the same policy twice.
 * - PRODUCT: the question is about the product itself (no operating topic), a product is bound, and the
 *   product lane is missing. When a rule exists but does not apply, a product-specific exception may be
 *   asked for — only when the question named a concrete property to ask about.
 * - null: nothing capturable — the existing 「답변 기준 추가」 link stays the honest path.
 */
export function captureGapOf(gap: KnowledgeGapView | null | undefined, ctx: CaptureContext, plannerTopic: string | null = null): OpenedGap | null {
  if (!gap) return null;
  const named = gap.topics ?? (gap.topic ? [gap.topic] : []);
  // The question names ONE operating topic, or names several and the plan's own POLICY gap picked one of
  // exactly those (「결제하고 나서 출고까지」 names 결제 and 출고; the plan asked for the 배송 rule). A planner
  // may disambiguate among the question's own words — never add a topic the words did not name.
  const topic = gap.topic && ORG_TOPIC[gap.topic] ? gap.topic
    : plannerTopic && ORG_TOPIC[plannerTopic] && named.includes(plannerTopic) ? plannerTopic : null;
  // Several topics and nothing to pick one: a policy-flavoured question is not a product fact. Only a
  // named property (a spec noun) can still be asked for, as the product's own.
  const ambiguousPolicy = !topic && named.length > 1;
  const policy = gap.policyOutcome;
  const product = gap.productOutcome;
  const productId = gap.productId ?? ctx.productId;
  const base = { inquiryId: ctx.inquiryId, workItemId: ctx.workItemId, productId, productName: ctx.productName, variantId: null, variantName: null };
  if (topic && policy && (policy === "ABSENT" || (policy === "NO_RELEVANT_EVIDENCE" && !gap.policyDeclaresTopic))) {
    const t = ORG_TOPIC[topic]!;
    return { ...base, scope: "ORG", topic, knowledgeType: t.knowledgeType, topicLabel: t.label, missingSubject: null, variantRequired: false, question: questionFor("ORG", topic, ctx.productName, null, false) };
  }
  if (!productId || !product || !MISSING.has(product)) return null;
  if (ambiguousPolicy && !gap.missingSubject) return null;
  if (topic) {
    // A rule exists for the topic (NOT_APPLICABLE, or declared but silent on this case): only a
    // product-specific exception can be asked for, and only when the question named what is missing.
    if (!gap.missingSubject) return null;
    const t = ORG_TOPIC[topic]!;
    return { ...base, scope: "PRODUCT", topic, knowledgeType: "POLICY", topicLabel: `${t.label} 예외`, missingSubject: gap.missingSubject, variantRequired: false, question: questionFor("PRODUCT_EXCEPTION", topic, ctx.productName, gap.missingSubject, false) };
  }
  const variantRequired = gap.applicability === "VARIANT_UNRESOLVED";
  const subject = gap.missingSubject;
  return {
    ...base, scope: "PRODUCT", topic: null, knowledgeType: "DESCRIPTION",
    topicLabel: subject ? `'${subject}' 정보` : "상품 정보", missingSubject: subject, variantRequired,
    question: questionFor("PRODUCT", null, ctx.productName, subject, variantRequired),
  };
}

/** The question, from a closed table. The product's name and the customer's noun are the only variables. */
export function questionFor(kind: "ORG" | "PRODUCT" | "PRODUCT_EXCEPTION", topic: string | null, productName: string | null, subject: string | null, variantRequired: boolean): string {
  const product = productName ? `${productName}의 ` : "이 상품의 ";
  if (kind === "ORG") {
    switch (topic) {
      case "SHIPPING": return "이 문의에 답하려면 일반 출고 기간 기준이 필요해요. 보통 결제 후 며칠 안에 출고하시나요?";
      case "EXCHANGE_RETURN": return `${productName ? product : ""}교환·반품 가능 기간 기준이 필요해요. 어떤 기준으로 안내하시나요?`;
      case "CANCELLATION": return "주문 취소 기준이 필요해요. 취소가 가능한 시점과 방법을 어떻게 안내하시나요?";
      case "PAYMENT": return "결제 안내 기준이 필요해요. 결제 방법이나 입금 안내를 어떻게 하시나요?";
      case "TAX_INVOICE": return "세금계산서 발행 기준이 필요해요. 발행 조건과 방법을 어떻게 안내하시나요?";
      case "CASH_RECEIPT": return "현금영수증 발행 기준이 필요해요. 발행 조건과 방법을 어떻게 안내하시나요?";
      default: return "이 문의에 답하려면 답변 기준이 하나 필요해요. 어떻게 안내하시나요?";
    }
  }
  if (kind === "PRODUCT_EXCEPTION") {
    const label = topic ? ORG_TOPIC[topic]?.label ?? "이" : "이";
    return `${product}'${subject}'에 대해 ${label} 기준과 다르게 안내하는 내용이 있나요? 있다면 어떻게 안내하시나요?`;
  }
  const ask = subject
    ? `${product}'${subject}' 정보가 아직 없어요. 판매자님이 안내하는 정확한 내용은 무엇인가요?`
    : `${product}이 질문에 답할 상품 정보가 아직 없어요. 판매자님이 안내하는 정확한 내용은 무엇인가요?`;
  return variantRequired ? `${ask} 규격에 따라 다르면 어느 규격 기준인지 함께 적어 주세요.` : ask;
}

/* ───────────── the seller's next sentence ───────────── */

export type SellerAnswerKind = "CANDIDATE" | "CANCEL" | "QUESTION" | "COMMAND";

const CANCEL_CUE = /^(취소|아니|아냐|그만|됐어|됐습니다|나중에|안\s?할래|안\s?할게|필요\s?없|건너뛰|넘어가|패스)/;
const CANCEL_TAIL = /(취소할게|취소해줘|취소해 줘|취소합니다|그만할게|그만둘게|나중에 할게|나중에 하자|건너뛰자|넘어가자)\s*[.!]?$/;
const QUESTION_TAIL = /(나요|까요|ㄹ까|을까|는지|어때|뭐야|뭐지|뭐였지|어떻게 돼|어떤 거야)\s*[?？.]?$/;
const COMMAND_TAIL = /(알려\s?줘|보여\s?줘|찾아\s?줘|확인해\s?줘|정리해\s?줘|준비해\s?줘|만들어\s?줘|보내\s?줘|열어\s?줘|해\s?줘|해주세요|주세요)\s*[.!]?$/;
export const CANDIDATE_MAX_CHARS = 2000;

/**
 * Is this sentence the fact the agent asked for? Closed cues only: a cancel word, a question ending, a
 * command ending, or one of the lane's own closed intents (tone, ordinal) means "not an answer". Anything
 * else the seller typed is taken as their answer, verbatim — the card then asks before saving.
 */
export function classifySellerAnswer(text: string): SellerAnswerKind {
  const t = text.trim();
  if (t.length < 2) return "COMMAND";
  if (CANCEL_CUE.test(t) || CANCEL_TAIL.test(t)) return "CANCEL";
  if (/[?？]\s*$/.test(t) || QUESTION_TAIL.test(t)) return "QUESTION";
  if (COMMAND_TAIL.test(t) || toneIntentOf(t) != null || ordinalSelectionOf(t) != null) return "COMMAND";
  return "CANDIDATE";
}

/** Whitespace and length only. The words, numbers and order are the seller's. */
export function normalizeContent(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{2,}/g, "\n").trim().slice(0, CANDIDATE_MAX_CHARS);
}

/** The document's title, the first line trimmed to 60 chars — the same convention the inquiry screen's quick-add uses. */
export function titleOf(content: string): string {
  const first = content.split("\n")[0]!.trim();
  return first.length <= 60 ? first : `${first.slice(0, 59)}…`;
}

/** The identity a confirmation binds to: scope, product, 규격, type and the exact normalized sentence. */
export function fingerprintOf(input: { scope: KnowledgeCaptureScope; productId: string | null; variantId: string | null; knowledgeType: string; content: string }): string {
  return createHash("sha256").update(JSON.stringify([input.scope, input.productId, input.variantId, input.knowledgeType, input.content])).digest("hex").slice(0, 16);
}

/* ───────────── 규격 (variant) naming ───────────── */

const GENERIC_CUE = /(모든 규격|전 규격|규격 (상관|관계)\s?없|규격 무관|공통(으로|이에요|입니다|이야)?|전부 (같|동일)|다 (같|동일))/;

export type VariantAnswer = { readonly kind: "VARIANT"; readonly id: string; readonly name: string } | { readonly kind: "GENERIC" } | { readonly kind: "UNRESOLVED" };

/**
 * Which 규격 the seller named, from the listing's own rows and nothing else — a whole option name, or one
 * of its tokens (「2호」) when that token belongs to exactly one option. 「공통」 makes the fact generic.
 */
export function variantFromAnswer(text: string, variants: ReadonlyArray<{ readonly id: string; readonly name: string }>): VariantAnswer {
  if (GENERIC_CUE.test(text)) return { kind: "GENERIC" };
  const whole = variants.filter((v) => v.name.trim().length > 0 && text.includes(v.name.trim()));
  if (whole.length === 1) return { kind: "VARIANT", id: whole[0]!.id, name: whole[0]!.name };
  if (whole.length > 1) return { kind: "UNRESOLVED" };
  const tokenHits = new Map<string, { id: string; name: string }[]>();
  for (const v of variants) {
    for (const token of v.name.split(/[\s/,()·]+/).filter((t) => t.length >= 2 && /\d/.test(t))) {
      if (!text.includes(token)) continue;
      tokenHits.set(token, [...(tokenHits.get(token) ?? []), { id: v.id, name: v.name }]);
    }
  }
  const unique = [...tokenHits.values()].filter((hits) => new Set(hits.map((h) => h.id)).size === 1);
  if (unique.length === 1) return { kind: "VARIANT", ...unique[0]![0]! };
  return { kind: "UNRESOLVED" };
}

/* ───────────── duplicate / conflict fence ───────────── */

export interface ExistingKnowledge {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** ORG: knowledgeType. PRODUCT: sourceType. */
  readonly type: string;
  readonly variantId?: string | null;
}

export type CandidateVerdict =
  | { readonly kind: "OK" }
  | { readonly kind: "DUPLICATE"; readonly existing: ExistingKnowledge }
  | { readonly kind: "CONFLICT"; readonly existing: ExistingKnowledge; readonly reason: "SAME_TITLE" | "DIFFERENT_FIGURE" };

const UNTYPED_ORG_KINDS: ReadonlySet<string> = new Set(["GENERAL_CS_FAQ", "OTHER"]);

const FIGURE = /(\d+(?:[.,]\d+)?)(?:\s*[~\-–]\s*(\d+(?:[.,]\d+)?))?\s*(영업일|일|시간|주|개월|원|%|mm|cm|km|kg|g|m)(?![a-z])/g;

/** Every 「값 단위」 the text states, keyed by unit — 「2~3일」 is one figure, not two. */
export function figuresOf(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of text.matchAll(FIGURE)) {
    const unit = m[3]!;
    const value = m[2] ? `${m[1]}~${m[2]}` : m[1]!;
    out.set(unit, new Set([...(out.get(unit) ?? []), value]));
  }
  return out;
}

/**
 * Compared against the rules/documents that already occupy the same scope: the same body is a duplicate
 * (no second row), the same title or the same unit with a different figure is a contradiction (no silent
 * overwrite — the settings screen decides). Anything else may be added beside them.
 */
export function judgeCandidate(
  content: string, title: string, existing: ReadonlyArray<ExistingKnowledge>,
  scope: { readonly type: string; readonly variantId: string | null; readonly scopeKind: KnowledgeCaptureScope },
): CandidateVerdict {
  // ORG: the same rule type, plus rules filed under the untyped kinds (공통 안내 · 기타) — a shipping figure
  // written there is still the company's shipping figure. PRODUCT: the same 규격 scope, or the whole listing.
  const same = existing.filter((e) => scope.scopeKind === "ORG"
    ? e.type === scope.type || UNTYPED_ORG_KINDS.has(e.type)
    : (e.variantId ?? null) === scope.variantId || e.variantId == null);
  const norm = normalizeContent(content);
  const dup = same.find((e) => normalizeContent(e.body) === norm);
  if (dup) return { kind: "DUPLICATE", existing: dup };
  const titled = same.find((e) => e.title.trim() === title.trim());
  if (titled) return { kind: "CONFLICT", existing: titled, reason: "SAME_TITLE" };
  const mine = figuresOf(norm);
  for (const e of same) {
    const theirs = figuresOf(normalizeContent(e.body));
    for (const [unit, values] of mine) {
      const other = theirs.get(unit);
      if (other && [...values].some((v) => !other.has(v))) return { kind: "CONFLICT", existing: e, reason: "DIFFERENT_FIGURE" };
    }
  }
  return { kind: "OK" };
}

/* ───────────── seller-facing sentences (closed) ───────────── */

export const CAPTURE_SENTENCE = {
  candidate: (label: string) => `이 내용을 ${label} 기준으로 저장할까요? 저장 전에는 아무것도 바뀌지 않습니다.`,
  cancelled: "기준 등록을 취소했습니다. 저장한 것은 없습니다.",
  stale: "이 확인은 더 이상 유효하지 않아 저장하지 않았습니다. 다시 말씀해 주시면 새로 확인하겠습니다.",
  duplicate: (label: string) => `같은 내용의 ${label} 기준이 이미 등록되어 있어 다시 저장하지 않았습니다.`,
  conflict: (label: string) => `기존 ${label} 기준과 내용이 다릅니다. 어느 쪽이 맞는지 설정 화면에서 정리해 주세요. 자동으로 덮어쓰지 않았습니다.`,
  variantUnresolved: (names: readonly string[]) => `어느 규격의 기준인지 함께 적어 주세요${names.length ? ` (예: ${names.slice(0, 3).join(" · ")})` : ""}. 모든 규격이 같다면 「공통」이라고 적어 주시면 됩니다.`,
  saved: (label: string) => `${label} 기준을 저장했습니다.`,
  savedNotActionable: "이 문의는 이미 처리되어 기준만 저장했습니다.",
  savedStillGap: "기준을 저장했지만 이 문의에 바로 적용할 근거로는 아직 부족합니다.",
  saveFailed: "기준을 저장하지 못했습니다. 잠시 후 다시 시도하거나 설정 화면에서 직접 등록해 주세요.",
  resumeGoal: "저장한 기준으로 원래 요청을 다시 확인합니다.",
} as const;

/** The settings screen for a captured fact's scope. */
export function settingsPathFor(scope: KnowledgeCaptureScope, productId: string | null): string {
  return scope === "ORG" || !productId ? SETTINGS_POLICIES : `/products/${productId}`;
}
