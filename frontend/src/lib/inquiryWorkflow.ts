import type { InquiryQueueItem, ProposalView } from "./types";

// Pure view-model for the seller inquiry workflow. No React, no network — just the
// display mapping + error classification the /inquiries page relies on, so the
// rules (sanitization, phase gating, 404/409/503 handling) are unit-testable.

export const PROPOSED = "PROPOSED";
export const OPEN = "OPEN";

export function isProposed(phase: string): boolean {
  return phase === PROPOSED;
}

/** Only an OPEN item may have a proposal generated. */
export function canGenerateProposal(phase: string): boolean {
  return phase === OPEN;
}

// Coarse response categories the rule provider emits → human labels. These are
// response-TYPE suggestions, never a reply body.
const CATEGORY_LABELS: Record<string, string> = {
  delivery_status_reply: "배송 상태 안내",
  exchange_return_reply: "교환·반품 안내",
  product_info_reply: "제품 정보 안내",
  installation_guidance_reply: "설치 안내",
  pricing_reply: "가격 안내",
  quality_issue_reply: "품질 문제 대응",
  stock_availability_reply: "재고 안내",
  general_reply: "일반 응답",
};

export function proposalCategoryLabel(summaryCategory: string): string {
  return CATEGORY_LABELS[summaryCategory] ?? humanizeCategory(summaryCategory);
}

function humanizeCategory(raw: string): string {
  const trimmed = raw.replace(/_reply$/, "").replace(/_/g, " ").trim();
  return trimmed.length > 0 ? trimmed : "응답 제안";
}

const PROVIDER_KIND_LABELS: Record<string, string> = {
  RULE_BASED: "규칙 기반",
};

export function providerKindLabel(kind: string): string {
  return PROVIDER_KIND_LABELS[kind] ?? kind;
}

/**
 * Provenance line for display — humanized kind + provider name/version only.
 * Deliberately omits proposedBy / actionKind / proposalId (audit/internal fields)
 * and never dumps the raw proposal object.
 */
export function provenanceText(p: ProposalView): string {
  return `${providerKindLabel(p.providerKind)} · ${p.providerName} ${p.providerVersion}`;
}

export function phaseLabel(phase: string): string {
  switch (phase) {
    case "OPEN":
      return "응답 대기";
    case "PROPOSED":
      return "제안 생성됨";
    default:
      return phase;
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "UNANSWERED":
      return "미답변";
    case "ANSWERED":
      return "답변완료";
    default:
      return status;
  }
}

/** Date-only rendering of an ISO instant — no timezone/clock assumptions. */
export function receivedDateLabel(receivedAt: string): string {
  return receivedAt.slice(0, 10);
}

/**
 * Sanitized display row for a queue item — the queue must never expose the
 * inquiry body/details or the author, so this projection carries neither (and the
 * source DTO has no such fields to begin with).
 */
export interface QueueRowView {
  workItemId: string;
  title: string;
  phaseLabel: string;
  statusLabel: string;
  receivedDate: string;
}

export function queueRowView(item: InquiryQueueItem): QueueRowView {
  return {
    workItemId: item.workItemId,
    title: item.title ?? "(제목 없음)",
    phaseLabel: phaseLabel(item.phase),
    statusLabel: statusLabel(item.status),
    receivedDate: receivedDateLabel(item.receivedAt),
  };
}

/**
 * Classify a proposal-generation failure by HTTP status:
 *  - 404 → the item is unavailable (gone from the queue),
 *  - 409 → the phase changed under us; the page should refresh,
 *  - 503 → generation is temporarily unavailable.
 * {@code shouldRefresh} tells the page whether to reload the detail + queue.
 */
export interface ProposeErrorInfo {
  message: string;
  shouldRefresh: boolean;
}

export function classifyProposeError(status: number | undefined): ProposeErrorInfo {
  switch (status) {
    case 404:
      return { message: "문의를 찾을 수 없습니다. 목록에서 사라졌을 수 있어요.", shouldRefresh: false };
    case 409:
      return { message: "문의 상태가 변경되었습니다. 최신 상태로 새로고침합니다.", shouldRefresh: true };
    case 503:
      return {
        message: "제안 생성을 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        shouldRefresh: false,
      };
    default:
      return { message: "제안 생성 중 문제가 발생했습니다. 다시 시도해 주세요.", shouldRefresh: false };
  }
}

/** Detail-load failure copy: a 404 is "unavailable", anything else is a generic error. */
export function detailErrorMessage(status: number | undefined): string {
  return status === 404
    ? "문의를 찾을 수 없습니다. 목록에서 사라졌을 수 있어요."
    : "문의를 불러오지 못했습니다. 다시 시도해 주세요.";
}

// --- Phase tabs (OPEN / PROPOSED) ---

export type InquiryTabKey = "OPEN" | "PROPOSED";

export interface InquiryTab {
  key: InquiryTabKey;
  /** The server phase this tab queries via the existing strict queue API. */
  phase: string;
  label: string;
  /** Phase-specific empty-state copy. */
  emptyCopy: string;
  emptySubCopy: string;
}

export const INQUIRY_TABS: readonly InquiryTab[] = [
  {
    key: "OPEN",
    phase: "OPEN",
    label: "응답 대기",
    emptyCopy: "응답 대기 중인 문의가 없습니다.",
    emptySubCopy: "새 문의가 수집되면 여기에 표시됩니다.",
  },
  {
    key: "PROPOSED",
    phase: "PROPOSED",
    label: "제안 생성됨",
    emptyCopy: "생성된 제안이 없습니다.",
    emptySubCopy: "‘응답 대기’ 탭에서 제안을 생성하면 여기에 표시됩니다.",
  },
];

export function tabFor(key: InquiryTabKey): InquiryTab {
  return INQUIRY_TABS.find((t) => t.key === key) ?? INQUIRY_TABS[0];
}

export function emptyCopyForTab(key: InquiryTabKey): string {
  return tabFor(key).emptyCopy;
}

/**
 * Guidance shown after a successful generate on the 응답 대기 tab: the item leaves
 * this tab (it is now PROPOSED) and can be found under 제안 생성됨. The tab is NOT
 * auto-switched — this only tells the seller where to look.
 */
export const PROPOSAL_SUCCESS_GUIDANCE =
  "제안이 생성되었습니다. ‘제안 생성됨’ 탭에서 확인할 수 있습니다.";

/**
 * The transient state to clear when the tab changes: page → 0, selection cleared,
 * detail closed, and any success message cleared. Scoped to the newly selected tab.
 */
export interface TabResetState {
  tab: InquiryTabKey;
  page: number;
  selectedId: string | null;
  successMessage: string | null;
}

export function resetForTab(key: InquiryTabKey): TabResetState {
  return { tab: key, page: 0, selectedId: null, successMessage: null };
}
