import type { Artifact } from "../../lib/conversation/types";
import { SummaryArtifact } from "./artifacts/SummaryArtifact";
import { MetricArtifact } from "./artifacts/MetricArtifact";
import { ListArtifact } from "./artifacts/ListArtifact";
import { TableArtifact } from "./artifacts/TableArtifact";
import { ReviewListArtifact } from "./artifacts/ReviewListArtifact";
import { InquiryListArtifact } from "./artifacts/InquiryListArtifact";
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

/** One component per artifact type. The switch is exhaustive: an unknown type renders nothing, never its token. */
export function ArtifactView({ artifact, onResume, onPrompt }: { artifact: Artifact; onResume: () => void; onPrompt?: (prompt: string) => void }) {
  switch (artifact.type) {
    case "SUMMARY":
      return <SummaryArtifact artifact={artifact} />;
    case "METRIC":
      return <MetricArtifact artifact={artifact} />;
    case "LIST":
      return <ListArtifact artifact={artifact} />;
    case "TABLE":
      return <TableArtifact artifact={artifact} />;
    case "REVIEW_LIST":
      return <ReviewListArtifact artifact={artifact} />;
    case "INQUIRY_LIST":
      return <InquiryListArtifact artifact={artifact} />;
    case "PRODUCT_LIST":
      return <ProductListArtifact artifact={artifact} />;
    case "ISSUE_LIST":
      return <IssueListArtifact artifact={artifact} />;
    case "ORDER_SUMMARY":
      return <OrderSummaryArtifact artifact={artifact} />;
    case "CHART":
      return <ChartArtifact artifact={artifact} />;
    case "DRAFT":
      return <DraftArtifact artifact={artifact} onPrompt={onPrompt} />;
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
    default:
      return null;
  }
}
