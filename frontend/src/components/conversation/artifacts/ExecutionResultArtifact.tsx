import { Link } from "react-router-dom";
import type { ExecutionResultArtifact as ExecutionResult, ObjectKind } from "../../../lib/conversation/types";
import { publishCategoryLabel } from "../../../lib/inquiryPublish";
import { Status } from "../../ui/Status";
import { ArtifactCard } from "./ArtifactCard";

/** Lifecycle words the seller reads. An unknown token renders nothing — never itself. */
const PHASE_WORD: Record<string, { word: string; tone: "good" | "warn" | "info" | "neutral" | "bad" }> = {
  APPROVED: { word: "승인됨", tone: "info" },
  ACTION_PENDING: { word: "전송 대기", tone: "info" },
  DISPATCHING: { word: "전송 중", tone: "info" },
  EXECUTED: { word: "전송됨", tone: "good" },
  COMPLETED: { word: "완료", tone: "good" },
  OPERATOR_REPORTED: { word: "등록 보고됨", tone: "info" },
  DELIVERY_UNKNOWN: { word: "확인 필요", tone: "warn" },
  FAILED: { word: "실패", tone: "bad" },
};

/**
 * What each verification value means, in the seller's words. Closed: the runtime's vocabulary and nothing
 * else; an unknown value renders no sentence. `good` is reserved for the one PROVEN state (VERIFIED) —
 * a composer that was filled or a submit that was seen is progress, not proof of what was posted.
 */
export const VERIFICATION_WORD: Record<string, { word: string; sentence: string; tone: "good" | "warn" | "info" | "neutral" }> = {
  VERIFIED: { word: "확인됨", sentence: "채널에서 등록된 답변을 다시 읽어 승인한 내용과 같은지 확인했습니다.", tone: "good" },
  STATUS_UNRESOLVED: { word: "등록됨", sentence: "답변은 등록됐고 완료 표시만 아직 확인하지 못했습니다. 다시 보내지 않습니다.", tone: "info" },
  DELIVERY_UNKNOWN: { word: "확인 필요", sentence: "등록 여부를 확인하지 못했습니다. 채널 화면에서 확인해 주세요.", tone: "warn" },
  UNVERIFIABLE: { word: "확인 불가", sentence: "채널을 다시 읽지 못해 등록 여부를 확인할 수 없었습니다.", tone: "warn" },
  COMPOSER_FILLED: { word: "초안 채움", sentence: "답변란에 승인한 초안을 채웠습니다. 등록은 판매자님이 누릅니다.", tone: "info" },
  SELLER_SUBMISSION_OBSERVED: { word: "등록 확인", sentence: "판매자님이 등록을 누른 것을 확인했습니다. 등록된 내용이 초안과 같은지는 확인하지 않습니다.", tone: "info" },
  SUBMISSION_OBSERVED_CONTENT_UNVERIFIED: { word: "답변 있음", sentence: "채널에 답변이 있는 것을 확인했습니다. 내용이 초안과 같은지는 확인하지 않습니다.", tone: "info" },
};

// The category vocabulary is NOT repeated here. This file used to keep its own allow-list of the
// five tokens it would render, spelled the same wrong way as the type — a second copy of the same
// mistake, which is how one divergence became silence on two surfaces. `publishCategoryLabel` owns
// the vocabulary and now answers safely for a token it does not know, so there is nothing left for
// a list here to decide. An absent category still renders no sentence: that is a missing field,
// not an unreadable state, and the phase chip above already says what is known.

function screenLabel(objectKind: ObjectKind | undefined): string {
  return objectKind === "REVIEW" ? "리뷰 화면에서 확인" : "문의 화면에서 확인";
}

export function ExecutionResultView({
  phase,
  category,
  verification,
  objectKind,
  to,
}: {
  phase: string;
  category: string;
  verification?: string | null;
  objectKind?: ObjectKind;
  to: string;
}) {
  const word = PHASE_WORD[phase];
  const sentence = category ? publishCategoryLabel(category) : null;
  const verified = verification ? (VERIFICATION_WORD[verification] ?? null) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {word ? <Status tone={word.tone}>{word.word}</Status> : null}
        {sentence ? <span className="break-keep text-sm text-ink">{sentence}</span> : null}
      </div>
      {verified ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="execution-verification">
          <Status tone={verified.tone}>{verified.word}</Status>
          <span className="break-keep text-sm text-muted">{verified.sentence}</span>
        </div>
      ) : null}
      <p className="text-sm">
        <Link to={to} className="font-semibold text-brand-700 hover:underline">{screenLabel(objectKind)}</Link>
      </p>
    </div>
  );
}

export function ExecutionResultArtifact({ artifact }: { artifact: ExecutionResult }) {
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
      <div className="px-4 pb-3">
        <ExecutionResultView
          phase={artifact.phase}
          category={artifact.category}
          verification={artifact.verification}
          objectKind={artifact.objectKind}
          to={artifact.to}
        />
      </div>
    </ArtifactCard>
  );
}
