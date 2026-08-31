import { Link } from "react-router-dom";
import type { KnowledgeCaptureArtifact as Capture } from "../../../lib/conversation/types";
import { Btn } from "../../ui/Btn";
import { Status } from "../../ui/Status";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

/**
 * Knowledge Capture v1 — one seller-stated fact on its way into the company's own answer basis.
 *
 * <b>What the seller wrote is what is saved.</b> The CANDIDATE card shows their sentence back verbatim
 * (whitespace only) and the two controls send a decision BOUND to that sentence's fingerprint; nothing
 * is written from this component, and a card that is no longer the latest turn shows no controls at
 * all — a stale 「저장하고 계속」 must not exist. DUPLICATE / CONFLICT say why nothing was saved and
 * hand over to the settings screen, which is also where every saved fact is edited by hand.
 */
const STATE_WORD: Record<Capture["state"], { word: string; tone: "good" | "warn" | "neutral" } | null> = {
  ASKED: null,
  CANDIDATE: { word: "저장 전", tone: "neutral" },
  SAVED: { word: "저장됨", tone: "good" },
  DUPLICATE: { word: "이미 등록됨", tone: "neutral" },
  CONFLICT: { word: "기존 기준과 다름", tone: "warn" },
  CANCELLED: { word: "취소됨", tone: "neutral" },
  STALE: { word: "무효", tone: "neutral" },
};

/**
 * What happened after the save, for the cases the TURN'S own sentence does not already carry.
 *
 * Working Context v1 §5: on a grounded re-draft the assistant already says 「저장한 기준을 근거로 답변
 * 초안을 다시 준비했습니다」 one line above, in the largest type on screen, and the new draft card is
 * right below — printing it a third time inside this card is exactly the repetition PO QA named. The
 * outcomes that the sentence does NOT cover keep their line, because nothing else says them.
 */
const RESUME_LINE: Partial<Record<NonNullable<Capture["resume"]>, string>> = {
  DRAFT_STILL_GAP: "저장했지만 이 문의에 바로 적용할 근거로는 아직 부족합니다.",
  INQUIRY_NOT_ACTIONABLE: "이 문의는 이미 처리되어 기준만 저장했습니다.",
  PENDING_RESUME: "저장한 기준으로 원래 요청을 다시 확인합니다.",
};

export function KnowledgeCaptureArtifact({ artifact, onDecision }: {
  artifact: Capture;
  onDecision?: (captureId: string, fingerprint: string, decision: "SAVE" | "CANCEL") => void;
}) {
  const onOpen = useContinueInPanel("KNOWLEDGE_CAPTURE");
  // ASKED draws NOTHING (Conversation UX v2 §D). The question is the assistant's own sentence, one
  // line above; a card that repeats it verbatim inside a box was the same ask twice — PO QA read the
  // gap loop as 「같은 의미를 여러 UI 요소로 반복」. The card returns when there is something new to
  // show: the sentence the seller wrote, and the decision bound to it.
  if (artifact.state === "ASKED") return null;
  const status = STATE_WORD[artifact.state];
  const scopeNote = [artifact.scope === "PRODUCT" ? artifact.productName ?? "이 상품" : "회사 공통", artifact.variantName].filter(Boolean).join(" · ");
  const decidable = artifact.state === "CANDIDATE" && artifact.fingerprint && onDecision;
  return (
    <ArtifactCard
      title={artifact.title}
      note={scopeNote || null}
      action={status ? <Status tone={status.tone}>{status.word}</Status> : undefined}
      testId="knowledge-capture"
    >
      <div className="space-y-2 px-4 pb-3">
        {artifact.content ? (
          <p className="whitespace-pre-wrap break-keep rounded-xl bg-canvas px-3 py-2 text-base leading-relaxed text-ink" data-testid="capture-content">{artifact.content}</p>
        ) : null}
        {artifact.existing ? (
          <p className="break-keep text-sm text-muted" data-testid="capture-existing">
            등록된 기준 「{artifact.existing.title}」: {artifact.existing.excerpt}
          </p>
        ) : null}
        {artifact.state === "SAVED" && artifact.resume && RESUME_LINE[artifact.resume] ? (
          <p className="break-keep text-sm text-muted" data-testid="capture-resume">{RESUME_LINE[artifact.resume]}</p>
        ) : null}
        {decidable ? (
          <div className="flex flex-wrap gap-2" aria-label="답변 기준 저장 확인">
            <Btn size="sm" onClick={() => onDecision(artifact.captureId, artifact.fingerprint!, "SAVE")}>저장하고 계속</Btn>
            <Btn size="sm" variant="outline" onClick={() => onDecision(artifact.captureId, artifact.fingerprint!, "CANCEL")}>취소</Btn>
          </div>
        ) : null}
        <p className="text-sm text-muted">
          <Link to={artifact.settingsTo} onClick={onOpen} className="hover:underline">설정에서 직접 편집</Link>
        </p>
      </div>
    </ArtifactCard>
  );
}
