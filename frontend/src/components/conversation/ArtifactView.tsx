import type { Artifact } from "../../lib/conversation/types";
import { SummaryArtifact } from "./artifacts/SummaryArtifact";
import { MetricArtifact } from "./artifacts/MetricArtifact";
import { ListArtifact } from "./artifacts/ListArtifact";
import { TableArtifact } from "./artifacts/TableArtifact";
import { ReviewListArtifact } from "./artifacts/ReviewListArtifact";
import { InquiryListArtifact } from "./artifacts/InquiryListArtifact";
import { InquiryDetailArtifact } from "./artifacts/InquiryDetailArtifact";
import { ProductListArtifact } from "./artifacts/ProductListArtifact";
import { IssueListArtifact } from "./artifacts/IssueListArtifact";
import { OrderSummaryArtifact } from "./artifacts/OrderSummaryArtifact";
import { ChartArtifact } from "./artifacts/ChartArtifact";
import { DraftArtifact } from "./artifacts/DraftArtifact";
import { EvidenceArtifact } from "./artifacts/EvidenceArtifact";
import { ChecklistArtifact } from "./artifacts/ChecklistArtifact";
import { HumanActionArtifact } from "./artifacts/HumanActionArtifact";
import { ApprovalArtifact } from "./artifacts/ApprovalArtifact";
import { GuidedExecutionArtifact } from "./artifacts/GuidedExecutionArtifact";
import { ExecutionResultArtifact } from "./artifacts/ExecutionResultArtifact";
import { WorkspaceLinkArtifact } from "./artifacts/WorkspaceLinkArtifact";
import { KnowledgeCaptureArtifact } from "./artifacts/KnowledgeCaptureArtifact";

/** One component per artifact type. The switch is exhaustive: an unknown type renders nothing, never its token. */
export function ArtifactView({ artifact, onResume, onPrompt, onCaptureDecision, stepped, headline }: {
  artifact: Artifact; onResume: () => void; onPrompt?: (prompt: string) => void;
  onCaptureDecision?: (captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL") => void;
  /** Channel codes THIS turn already raised as a step — so a list does not restate what the step card says. */
  stepped?: readonly string[];
  /** The sentence the agent said above these objects — a card whose title it already contains drops the header. */
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
    case "APPROVAL":
      return <ApprovalArtifact artifact={artifact} />;
    case "GUIDED_EXECUTION":
      return <GuidedExecutionArtifact artifact={artifact} />;
    case "EXECUTION_RESULT":
      return <ExecutionResultArtifact artifact={artifact} />;
    case "WORKSPACE_LINK":
      return <WorkspaceLinkArtifact artifact={artifact} />;
    case "KNOWLEDGE_CAPTURE":
      return <KnowledgeCaptureArtifact artifact={artifact} onDecision={onCaptureDecision} />;
    default:
      return null;
  }
}
