import type { KnowledgeTopicValue } from "../../lib/knowledgeWords";
import type { OpportunityKind, OpportunityStatus, OpportunityView } from "../../lib/types";
import type { StatusTone } from "../ui/Status";

/**
 * The seller's words for an opportunity's kind and status, and where an accepted draft can go.
 *
 * <b>Two destinations, and both already exist.</b> An FAQ or an operating-rule draft becomes knowledge
 * through the quick-add the inquiry and review screens use (a seller-owned write, no model, indexed on
 * save). A detail-page note or an improvement memo is text the seller carries elsewhere — reviewnary
 * has no marketplace write for a detail page and wants none, so the action is a copy. Nothing here
 * publishes.
 */
export const KIND_TONE: Record<OpportunityKind, StatusTone> = {
  FAQ_SUPPLEMENT: "info",
  PRODUCT_GUIDE_SUPPLEMENT: "info",
  OPERATING_POLICY_SUPPLEMENT: "info",
  PRODUCT_IMPROVEMENT_REVIEW: "warn",
};

export const STATUS_TONE: Record<OpportunityStatus, StatusTone> = {
  OPEN: "neutral",
  ACCEPTED: "info",
  DISMISSED: "neutral",
};

export type DraftDestination =
  | { kind: "KNOWLEDGE"; scope: "PRODUCT" | "ORG"; topic: KnowledgeTopicValue; label: string }
  | { kind: "COPY"; label: string };

/** Where this opportunity's draft goes once the seller is done with it. */
export function destinationOf(o: OpportunityView): DraftDestination {
  switch (o.kind) {
    case "FAQ_SUPPLEMENT":
      return { kind: "KNOWLEDGE", scope: "PRODUCT", topic: "FAQ", label: "답변 기준으로 저장" };
    case "OPERATING_POLICY_SUPPLEMENT":
      return {
        kind: "KNOWLEDGE",
        scope: "ORG",
        // The backend names the rule this guidance is about; the screen only carries it.
        topic: (o.knowledge?.type as KnowledgeTopicValue | undefined) ?? "GENERAL_CS_FAQ",
        label: "운영 기준으로 저장",
      };
    case "PRODUCT_GUIDE_SUPPLEMENT":
      return { kind: "COPY", label: "안내문 복사" };
    case "PRODUCT_IMPROVEMENT_REVIEW":
      return { kind: "COPY", label: "메모 복사" };
  }
}

/** Opportunities a seller can still act on — what a count on a product page may say. */
export function actionable(list: readonly OpportunityView[]): OpportunityView[] {
  return list.filter((o) => o.status !== "DISMISSED");
}
