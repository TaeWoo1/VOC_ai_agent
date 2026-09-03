import { useState } from "react";
import type { Artifact } from "../../lib/conversation/types";
import { SummaryArtifact } from "./artifacts/SummaryArtifact";
import { MetricArtifact } from "./artifacts/MetricArtifact";
import { ListArtifact } from "./artifacts/ListArtifact";
import { TableArtifact } from "./artifacts/TableArtifact";
import { ReviewListArtifact } from "./artifacts/ReviewListArtifact";
import { InquiryListArtifact } from "./artifacts/InquiryListArtifact";
import { InquiryDetailArtifact } from "./artifacts/InquiryDetailArtifact";
import { ReviewDetailArtifact } from "./artifacts/ReviewDetailArtifact";
import { ProductListArtifact } from "./artifacts/ProductListArtifact";
import { IssueListArtifact } from "./artifacts/IssueListArtifact";
import { OrderSummaryArtifact } from "./artifacts/OrderSummaryArtifact";
import { ChartArtifact } from "./artifacts/ChartArtifact";
import { DraftArtifact } from "./artifacts/DraftArtifact";
import { EvidenceArtifact } from "./artifacts/EvidenceArtifact";
import { ChecklistArtifact } from "./artifacts/ChecklistArtifact";
import { HumanActionArtifact } from "./artifacts/HumanActionArtifact";
import { ApprovalArtifact } from "./artifacts/ApprovalArtifact";
import { ReplyApprovalArtifact } from "./artifacts/ReplyApprovalArtifact";
import { GuidedExecutionArtifact } from "./artifacts/GuidedExecutionArtifact";
import { ExecutionResultArtifact } from "./artifacts/ExecutionResultArtifact";
import { AcquisitionResultArtifact } from "./artifacts/AcquisitionResultArtifact";
import { WorkspaceLinkArtifact } from "./artifacts/WorkspaceLinkArtifact";
import { KnowledgeCaptureArtifact } from "./artifacts/KnowledgeCaptureArtifact";

/**
 * How many objects a bulk list is carrying, and what to call them — or `null` for an artifact that is not
 * a list at all. Used only to decide whether an OLDER turn keeps its rows on screen.
 */
function bulkSize(artifact: Artifact): { count: number; noun: string } | null {
  switch (artifact.type) {
    case "INQUIRY_LIST":
      return { count: artifact.groups.reduce((n, g) => n + g.items.length, 0), noun: "문의" };
    case "REVIEW_LIST":
      return { count: artifact.items.length, noun: "리뷰" };
    case "PRODUCT_LIST":
      return { count: artifact.items.length, noun: "상품" };
    case "ISSUE_LIST":
      return { count: artifact.items.length, noun: "반복 문제" };
    case "LIST":
      return { count: artifact.items.length, noun: "항목" };
    case "CHECKLIST":
      return { count: artifact.items.length, noun: "할 일" };
    default:
      return null;
  }
}

/**
 * **A finished turn keeps its answer and folds its list.**
 *
 * Measured on the real Demo Org, 2026-09-02: four turns of ordinary conversation left 144 rows and 82
 * controls on one screen, because every turn appended its whole list and nothing ever collapsed. The list is
 * how the seller READ that turn; it is not what they are reading now, and a transcript where each answer
 * buries the one above it is a workflow screen wearing a chat's clothes.
 *
 * The row count is kept — it is the fact the turn established — and one press brings the rows back, so
 * nothing is lost, only put away. Small lists (≤ 3) are left alone: folding three rows into a line that says
 * "three rows" saves nothing and costs a press.
 */
function FoldedList({ size, children }: { size: { count: number; noun: string }; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-sm text-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <span aria-hidden="true">▸</span>
      <span>
        {size.noun} {size.count}건 다시 보기
      </span>
    </button>
  );
}

/** One component per artifact type. The switch is exhaustive: an unknown type renders nothing, never its token. */
export function ArtifactView({ artifact, onResume, onPrompt, onCaptureDecision, stepped, headline, latest = true, secondary = false }: {
  artifact: Artifact; onResume: () => void; onPrompt?: (prompt: string) => void;
  onCaptureDecision?: (captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL") => void;
  /** Channel codes THIS turn already raised as a step — so a list does not restate what the step card says. */
  stepped?: readonly string[];
  /** The sentence the agent said above these objects — a card whose title it already contains drops the header. */
  headline?: string;
  /** Is this the turn the seller is reading? An older turn folds its bulk lists away. */
  latest?: boolean;
  /**
   * **One primary object collection per turn** (Chat-first Outcome & Visual Closure v1 §4). Set on every
   * collection after the first in a turn the seller asked ONE question of: the second list is folded to
   * its count, exactly as an older turn's is. Nothing is hidden — the count is the fact, and one press
   * brings the rows back — but the answer is not two lists deep before the seller has read the first.
   */
  secondary?: boolean;
}) {
  const size = latest && !secondary ? null : bulkSize(artifact);
  if (size && size.count > 3) {
    return (
      <FoldedList size={size}>
        <ArtifactBody artifact={artifact} onResume={onResume} onPrompt={onPrompt} onCaptureDecision={onCaptureDecision} stepped={stepped} headline={headline} />
      </FoldedList>
    );
  }
  return <ArtifactBody artifact={artifact} onResume={onResume} onPrompt={onPrompt} onCaptureDecision={onCaptureDecision} stepped={stepped} headline={headline} />;
}

function ArtifactBody({ artifact, onResume, onPrompt, onCaptureDecision, stepped, headline }: {
  artifact: Artifact; onResume: () => void; onPrompt?: (prompt: string) => void;
  onCaptureDecision?: (captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL") => void;
  stepped?: readonly string[];
  headline?: string;
}) {
  switch (artifact.type) {
    case "SUMMARY":
      return <SummaryArtifact artifact={artifact} headline={headline} />;
    case "METRIC":
      return <MetricArtifact artifact={artifact} />;
    case "LIST":
      return <ListArtifact artifact={artifact} />;
    case "TABLE":
      return <TableArtifact artifact={artifact} />;
    case "REVIEW_LIST":
      return <ReviewListArtifact artifact={artifact} stepped={stepped} headline={headline} />;
    case "INQUIRY_LIST":
      return <InquiryListArtifact artifact={artifact} onPrompt={onPrompt} headline={headline} />;
    case "INQUIRY_DETAIL":
      return <InquiryDetailArtifact artifact={artifact} onPrompt={onPrompt} />;
    case "REVIEW_DETAIL":
      return <ReviewDetailArtifact artifact={artifact} onPrompt={onPrompt} />;
    case "PRODUCT_LIST":
      return <ProductListArtifact artifact={artifact} headline={headline} />;
    case "ISSUE_LIST":
      return <IssueListArtifact artifact={artifact} headline={headline} />;
    case "ORDER_SUMMARY":
      return <OrderSummaryArtifact artifact={artifact} />;
    case "CHART":
      return <ChartArtifact artifact={artifact} />;
    case "DRAFT":
      return <DraftArtifact artifact={artifact} onPrompt={onPrompt} headline={headline} />;
    case "EVIDENCE":
      return <EvidenceArtifact artifact={artifact} />;
    case "CHECKLIST":
      return <ChecklistArtifact artifact={artifact} />;
    case "HUMAN_ACTION_REQUIRED":
      return <HumanActionArtifact artifact={artifact} onResume={onResume} />;
    case "APPROVAL_REQUIRED":
      return <ReplyApprovalArtifact artifact={artifact} />;
    case "APPROVAL":
      return <ApprovalArtifact artifact={artifact} />;
    case "GUIDED_EXECUTION":
      return <GuidedExecutionArtifact artifact={artifact} />;
    case "EXECUTION_RESULT":
      return <ExecutionResultArtifact artifact={artifact} />;
    case "ACQUISITION_RESULT":
      return <AcquisitionResultArtifact artifact={artifact} />;
    case "WORKSPACE_LINK":
      return <WorkspaceLinkArtifact artifact={artifact} />;
    case "KNOWLEDGE_CAPTURE":
      return <KnowledgeCaptureArtifact artifact={artifact} onDecision={onCaptureDecision} />;
    default:
      return null;
  }
}
