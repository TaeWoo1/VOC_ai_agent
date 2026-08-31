/**
 * ANALYZE — advisory over the selected inquiry (Conversation Core v1).
 *
 * <b>Advice is not a draft, and the actionability gate does not apply to it.</b> 「이 고객한테 뭐라고
 * 답하면 좋을까?」 over an already-answered inquiry used to be read as PREPARE and refused
 * (「이미 답변된 문의라 새 초안은 만들지 않았습니다」) — the conversation dead-ended on a question the
 * seller was entitled to ask. This lane answers it: the inquiry's state as a fact (never a refusal),
 * then what the company's OWN corpus says a reply could stand on — the same three retrieval seams the
 * draft composer reads (org rules · this product's documents · past approved answers), each an
 * org-scoped READ, each outcome reported honestly.
 *
 * <b>No model call, no write, no marketplace call.</b> Every sentence here is deterministic prose over
 * seller-authored content: source label + the document's own title + a bounded excerpt (the same
 * `excerpt()` bound the conflict cards use — never a full read-back, Response Hygiene v1). A DRAFTABLE
 * inquiry does not come here — for it the best advice IS a draft, and the caller runs the existing
 * PREPARE step instead.
 */
import type { SpringClientBundle } from "../http/AgentRunService";
import type { Artifact, SuggestedAction, SummaryArtifact } from "./contract";
import type { InquiryActionability } from "./inquiryActionability";
import { excerpt } from "../operator/wording/sellerWording";
import { log } from "../log";

/** The state, said as a fact the advice stands beside — never the PREPARE lane's refusal sentence. */
const STATE_FACT: Record<Exclude<InquiryActionability, "DRAFTABLE">, string> = {
  ALREADY_ANSWERED: "이미 답변된 문의입니다.",
  AWAITING_SEND: "승인된 답변이 전송을 기다리는 문의입니다.",
  NOT_WORKABLE: "지금은 초안을 붙일 수 없는 문의입니다.",
};

const NOTHING_FOUND_LINE = "등록된 운영 기준·상품 정보·과거 답변에서 이 문의에 참고할 내용을 찾지 못했습니다.";
const FOUND_LINE = "등록된 기준과 과거 답변에서 참고하실 답변 방향을 정리했습니다.";

/** How many passages each lane may quote. Advice is a direction, not a dossier. */
const PASSAGES_PER_LANE = 2;

export interface AdvisoryTarget {
  readonly inquiryId: string;
  readonly workItemId: string | null;
  readonly productId: string | null;
  readonly title: string | null;
  readonly actionability: Exclude<InquiryActionability, "DRAFTABLE">;
}

export interface AdvisoryResult {
  readonly headline: string;
  readonly artifacts: Artifact[];
  readonly suggestedActions: SuggestedAction[];
  readonly toolCalls: number;
}

/**
 * Advise on one non-draftable inquiry: ≤1 detail READ (the question's own words when the row has a
 * work item), then the three retrieval READs, then deterministic composition. Failures of any single
 * read cost that lane its passages and nothing else.
 */
export async function adviseOnInquiry(bundle: SpringClientBundle, target: AdvisoryTarget): Promise<AdvisoryResult> {
  let reads = 0;
  let query = (target.title ?? "").trim();
  if (target.workItemId) {
    try {
      reads += 1;
      const detail = await bundle.inquiry.getInquiryDetail(target.workItemId);
      query = (detail.title ?? query).trim() || query;
    } catch {
      // The persisted title stands in; a failed read is not a failed advisory.
    }
  }

  const lines: string[] = [];
  let searched = 0;
  if (query.length > 0) {
    const [org, memory, product] = await Promise.all([
      (async () => {
        if (typeof bundle.operator.searchOrgKnowledge !== "function") return null;
        try {
          searched += 1;
          return await bundle.operator.searchOrgKnowledge(query, PASSAGES_PER_LANE);
        } catch { return null; }
      })(),
      (async () => {
        if (typeof bundle.operator.searchAnswerMemory !== "function") return null;
        try {
          searched += 1;
          return await bundle.operator.searchAnswerMemory({
            query, limit: PASSAGES_PER_LANE,
            ...(target.productId ? { productId: target.productId } : {}),
            excludeInquiryId: target.inquiryId,
          });
        } catch { return null; }
      })(),
      (async () => {
        if (!target.productId) return null;
        try {
          searched += 1;
          return await bundle.operator.searchProductKnowledge(target.productId, query, PASSAGES_PER_LANE);
        } catch { return null; }
      })(),
    ]);
    reads += searched;
    for (const p of (org?.passages ?? []).slice(0, PASSAGES_PER_LANE)) {
      lines.push(`운영 정책 「${p.title}」 — ${excerpt(p.content)}`);
    }
    for (const p of (product?.passages ?? []).slice(0, PASSAGES_PER_LANE)) {
      lines.push(`상품 정보 「${p.title}」 — ${excerpt(p.content)}`);
    }
    for (const p of (memory?.passages ?? []).slice(0, PASSAGES_PER_LANE)) {
      lines.push(`과거 답변${p.answerTitle ? ` 「${p.answerTitle}」` : ""} — ${excerpt(p.answerBody)}`);
    }
  }

  const fact = STATE_FACT[target.actionability];
  const found = lines.length > 0;
  log("conversation_advisory", { actionability: target.actionability, lanes: searched, passages: lines.length, reads });
  const artifacts: Artifact[] = found
    ? [{
        artifactId: `a-advice-${target.inquiryId}`, type: "SUMMARY", title: "참고할 답변 방향",
        lines,
      } satisfies SummaryArtifact]
    : [];
  return {
    headline: found ? `${fact} ${FOUND_LINE}` : `${fact} ${NOTHING_FOUND_LINE}`,
    artifacts,
    suggestedActions: found
      ? [{ label: "답변 안 한 문의만 보여줘", kind: "PROMPT", prompt: "답변 안 한 문의만 보여줘" }]
      : [
          { label: "답변 기준 추가", kind: "LINK", to: target.productId ? `/inquiries/${target.inquiryId}` : "/settings/policies" },
          { label: "답변 안 한 문의만 보여줘", kind: "PROMPT", prompt: "답변 안 한 문의만 보여줘" },
        ],
    toolCalls: reads,
  };
}
