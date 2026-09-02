import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DraftArtifact as Draft } from "../../../lib/conversation/types";
import { Status } from "../../ui/Status";
import { Btn } from "../../ui/Btn";
import { api } from "../../../lib/apiClient";
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

/** The two follow-ups a draft invites, as the sentences the conversation already understands. */
const REVISE_PROMPT = "조금 더 부드럽게 써줘";
const SEND_PROMPT = "좋아 보내자";

/**
 * A prepared reply, body first (Seller-facing Response Hygiene v1 §5): the seller reads the draft here,
 * sees its grounding as one compact line, and moves on with 「말투 다듬기」 / 「보내기 준비」 — both are
 * conversation sentences, and 「보내기 준비」 only leads to the Approval artifact, which owns the one
 * irreversible control. The inquiry screen is a secondary link, not the default path.
 *
 * The body is the stored version's text as the runtime handed it over; on a reloaded thread it is
 * re-read from the inquiry's own detail (the same saved version — nothing is regenerated). [초안 복사]
 * copies exactly that stored text and never claims a copy that did not happen.
 */
export function DraftArtifact({ artifact, onPrompt, headline }: { artifact: Draft; onPrompt?: (prompt: string) => void; headline?: string }) {
  const onOpen = useContinueInPanel("DRAFT");
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [reloaded, setReloaded] = useState<{ state: "loading" | "loaded" | "superseded" | "failed"; body: string | null }>({ state: "loading", body: null });
  const basis = artifact.answerBasis;
  const basisWord = basis ? (BASIS_WORD[basis] ?? null) : null;
  const machinery = artifact.unavailableMessage;
  const inquiryDraft = (artifact.objectKind ?? "INQUIRY") === "INQUIRY";
  const body = artifact.comments ?? reloaded.body;
  const noDraft = artifact.version == null && !machinery;

  // A reloaded thread carries no body: read the same saved version back from the inquiry (READ only).
  useEffect(() => {
    if (artifact.comments || artifact.version == null || !inquiryDraft) return;
    let live = true;
    api.getInquiryDetailStrict(artifact.workItemId)
      .then((detail) => {
        if (!live) return;
        // Only the head version is readable back; an older card says it was superseded rather than loading forever.
        if (detail.draft?.version === artifact.version) setReloaded({ state: "loaded", body: detail.draft.comments });
        else setReloaded({ state: "superseded", body: null });
      })
      .catch(() => { if (live) setReloaded({ state: "failed", body: null }); });
    return () => { live = false; };
  }, [artifact.comments, artifact.version, artifact.workItemId, inquiryDraft]);

  async function copy() {
    if (!body) return;
    const result = await copyText(body);
    setCopied(result.ok ? "done" : "failed");
  }

  const grounding = [
    ...(artifact.evidenceSummary ?? []).map((s) => `${s.scopeLabel} ${s.count}`),
    ...(artifact.companyContextUsed ? ["회사 정보 참고"] : []),
  ];

  // ONE representation per fact (Conversation UX v2 §D): this card exists to show a DRAFT. With no
  // saved version there is none, and every sentence it could put in the box — what is missing, why the
  // draft could not be made — is already the turn's own sentence, with the next step on its own card.
  // Live QA read the old shape as one outcome stated three times.
  if (artifact.version == null) return null;

  return (
    <ArtifactCard
      framed
      title={artifact.title}
      note={[artifact.channelNameKo, artifact.productName, artifact.version != null ? `버전 ${artifact.version}` : null].filter(Boolean).join(" · ") || null}
      action={
        body ? (
          <Btn size="sm" variant="outline" onClick={copy}>
            {copied === "done" ? "복사했습니다" : "초안 복사"}
          </Btn>
        ) : undefined
      }
      testId="draft-artifact"
      headline={headline}
    >
      <div className="space-y-2 px-4 pb-3">
        {machinery ? (
          <p className="break-keep rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">{machinery}</p>
        ) : null}
        {body ? (
          // The draft is what the seller came for, and it was the smallest text in its own card: 16px
          // regular inside a grey inset, under a 17px announcement of it. It is now the largest thing in
          // the turn (design contract §1 — 「the customer's sentence, the draft」 are `lg`), and it is no
          // longer a panel inside a panel: one hairline on the left marks it as quoted text.
          <p className="whitespace-pre-wrap break-keep border-l-2 border-brand-700/30 pl-3 text-lg leading-relaxed text-ink" data-testid="draft-body">{body}</p>
        ) : noDraft ? (
          <p className="break-keep text-sm text-muted" data-testid="draft-gap">
            {artifact.answerBasisNote ?? "초안을 만들려면 답변 기준이 하나 더 필요합니다."}
          </p>
        ) : !machinery ? (
          <p className="text-sm text-muted" data-testid="draft-reload">
            {reloaded.state === "superseded" ? "이 초안은 이후 버전으로 바뀌었습니다. 최신 초안은 아래 카드에 있습니다."
              : reloaded.state === "failed" ? "저장된 초안을 불러오지 못했습니다. 아래 화면에서 확인해 주세요."
                : "저장된 초안을 불러오는 중입니다."}
          </p>
        ) : null}
        {body && (basis || grounding.length > 0) ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" aria-label="초안 근거">
            {basis && basisWord ? <Status tone={answerStateIsGood(basis as "GROUNDED") ? "good" : "warn"}>{basisWord}</Status> : null}
            {basis === "NEEDS_CLARIFICATION" && artifact.answerBasisNote ? <span className="break-keep">{artifact.answerBasisNote}</span> : null}
            {grounding.length > 0 ? <span>근거 · {grounding.join(" · ")}</span> : null}
          </p>
        ) : null}
        {copied === "failed" ? <p className="text-sm text-muted">이 브라우저에서는 복사할 수 없습니다. 아래 화면에서 옮겨 주세요.</p> : null}
        {body && onPrompt ? (
          <div className="flex flex-wrap gap-2" aria-label="초안 다음 단계">
            <Btn size="sm" variant="outline" onClick={() => onPrompt(REVISE_PROMPT)}>말투 다듬기</Btn>
            <Btn size="sm" onClick={() => onPrompt(SEND_PROMPT)}>보내기 준비</Btn>
          </div>
        ) : null}
        {/* Two different facts, and they were running together on one line as one sentence — a link and
            a guarantee. The guarantee is the one that matters, so it gets the line. */}
        <p className="text-sm text-muted">아직 아무 곳에도 보내지 않았습니다.</p>
        <p className="text-sm">
          <Link to={artifact.to} onClick={onOpen} className="text-muted hover:text-ink hover:underline">
            {inquiryDraft ? "문의 화면에서 직접 고치기" : "리뷰 화면에서 직접 고치기"}
          </Link>
        </p>
      </div>
    </ArtifactCard>
  );
}
