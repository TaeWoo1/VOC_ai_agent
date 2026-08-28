import { useState } from "react";
import { Link } from "react-router-dom";
import type { DraftArtifact as Draft } from "../../../lib/conversation/types";
import { Status } from "../../ui/Status";
import { Btn } from "../../ui/Btn";
import { copyText } from "../../../lib/clipboard";
import { answerStateIsGood } from "../../../lib/answerState";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

/** Fallback words when the runtime sent no note — the 문의 screen's own vocabulary. */
const BASIS_WORD: Record<string, string> = {
  GROUNDED: "근거 있는 답변",
  NEEDS_CLARIFICATION: "고객에게 되묻는 답변",
  NO_ANSWER_BASIS: "답변 기준이 필요합니다",
};

/**
 * A prepared reply. The body is the stored version's text as the runtime handed it over (transient
 * — a reloaded conversation shows the link only). [초안 복사] copies exactly that stored text and never
 * claims a copy that did not happen. Sending is not here: the Approval artifact owns it.
 */
export function DraftArtifact({ artifact }: { artifact: Draft }) {
  const onOpen = useContinueInPanel("DRAFT");
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const basis = artifact.answerBasis;
  const basisWord = basis ? (BASIS_WORD[basis] ?? null) : null;
  const machinery = artifact.unavailableMessage;

  async function copy() {
    if (!artifact.comments) return;
    const result = await copyText(artifact.comments);
    setCopied(result.ok ? "done" : "failed");
  }

  return (
    <ArtifactCard
      title={artifact.title}
      note={[artifact.channelNameKo, artifact.productName, artifact.version != null ? `버전 ${artifact.version}` : null].filter(Boolean).join(" · ") || null}
      action={
        artifact.comments ? (
          <Btn size="sm" variant="outline" onClick={copy}>
            {copied === "done" ? "복사했습니다" : "초안 복사"}
          </Btn>
        ) : undefined
      }
      testId="draft-artifact"
    >
      <div className="space-y-2 px-4 pb-3">
        {machinery ? (
          <p className="break-keep rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">{machinery}</p>
        ) : basis ? (
          <div className="flex flex-wrap items-center gap-2">
            <Status tone={answerStateIsGood(basis as "GROUNDED") ? "good" : "warn"}>{basisWord ?? "답변 상태"}</Status>
            {artifact.answerBasisNote ? <span className="break-keep text-sm text-muted">{artifact.answerBasisNote}</span> : null}
          </div>
        ) : null}
        {artifact.comments ? (
          <p className="whitespace-pre-wrap break-keep rounded-xl bg-canvas px-3 py-2 text-base leading-relaxed text-ink">{artifact.comments}</p>
        ) : artifact.version == null ? (
          <p className="text-sm text-muted">초안이 아직 없습니다. 답변 기준을 추가하면 다시 준비합니다.</p>
        ) : (
          <p className="text-sm text-muted">초안 본문은 문의 화면에서 확인할 수 있습니다.</p>
        )}
        {copied === "failed" ? <p className="text-sm text-muted">이 브라우저에서는 복사할 수 없습니다. 문의 화면에서 옮겨 주세요.</p> : null}
        <p className="text-sm">
          <Link to={artifact.to} onClick={onOpen} className="font-semibold text-brand-700 hover:underline">문의 화면에서 확인</Link>
          <span className="ml-2 text-muted">아직 아무 곳에도 보내지 않았습니다.</span>
        </p>
      </div>
    </ArtifactCard>
  );
}
