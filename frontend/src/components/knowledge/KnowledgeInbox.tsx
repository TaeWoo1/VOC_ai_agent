import { useState } from "react";
import { isAxiosError } from "axios";
import { Btn } from "../ui/Btn";
import { DecisionList, DecisionRow } from "../ui/DecisionRow";
import { KnowledgeQuickAdd } from "./KnowledgeQuickAdd";
import { api } from "../../lib/apiClient";
import { scopeLabel } from "../../lib/knowledgeWords";
import { COPY, shortDate } from "../../lib/copy/customerOps";
import type { KnowledgeCandidateView, KnowledgeDocumentView } from "../../lib/types";

/**
 * <b>확인 필요 — everything waiting for the seller, in one place.</b>
 * (Knowledge Setup &amp; Inbox UX v1 §3, §8)
 *
 * <p>Three kinds, and they are three because they call for three different readings:
 *
 * <ul>
 *   <li><b>정보 필요</b> — a question a draft ran into and could not answer. The seller writes the
 *       fact. The stored text is the QUESTION, so it is shown as one and never offered as an
 *       answer: pressing 「답변 기준 추가」 opens the editor with an EMPTY body. Before this it
 *       opened nothing and 「답변 기준으로 등록」 filed the question itself as the company's
 *       official knowledge — measured on 2026-09-03, a product FAQ whose body read 「…공식 기준이
 *       있나요? 이 상품에 저장된 지식에서 찾지 못했습니다.」, indexed and citable.</li>
 *   <li><b>확인할 후보</b> — a sentence THIS seller has written to customers many times. It is
 *       theirs, verbatim, so the editor opens prefilled and they confirm or edit it.</li>
 *   <li><b>자료 문제</b> — only what is deterministically detectable today: a document that
 *       produced no passages cannot be quoted, and a list that showed it as normal would be
 *       hiding that. No conflict engine, and nothing is guessed.</li>
 * </ul>
 *
 * <p>Nothing here promotes anything on its own. Every write is a press.
 */
export function KnowledgeInbox({
  candidates,
  documents,
  onChanged,
}: {
  candidates: KnowledgeCandidateView[];
  documents: KnowledgeDocumentView[];
  onChanged: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const gaps = candidates.filter((c) => c.origin === "DRAFT_GAP");
  const repeats = candidates.filter((c) => c.origin !== "DRAFT_GAP");
  const unusable = documents.filter((d) => d.active && d.passages === 0);

  if (gaps.length === 0 && repeats.length === 0 && unusable.length === 0) {
    return <p className="break-keep px-1 text-sm text-muted">{COPY.toEnter} {COPY.none}</p>;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="knowledge-inbox">
      {error ? <p className="break-keep text-sm text-bad" role="alert">{error}</p> : null}
      <DecisionList ariaLabel={COPY.toEnter}>
        {gaps.map((candidate, i) => (
          <CandidateRow key={candidate.id} candidate={candidate} primary={i === 0} onChanged={onChanged} onError={setError} />
        ))}
        {repeats.map((candidate) => (
          <CandidateRow key={candidate.id} candidate={candidate} primary={false} onChanged={onChanged} onError={setError} />
        ))}
        {unusable.map((document) => (
          <DecisionRow
            key={document.sourceId}
            tone="amber"
            icon="box"
            tag="자료 문제"
            source={scopeLabel(document.scope, document.productName)}
            title={document.fileName ?? document.title}
            line={COPY.noContent}
            action={
              <Btn
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api.setKnowledgeDocumentActive(document.sourceId, false);
                    await onChanged();
                  } catch {
                    setError("상태 변경 실패 · 다시 시도");
                  }
                }}
              >
                {COPY.stopUsing}
              </Btn>
            }
          />
        ))}
      </DecisionList>
    </div>
  );
}

function CandidateRow({
  candidate,
  primary,
  onChanged,
  onError,
}: {
  candidate: KnowledgeCandidateView;
  primary: boolean;
  onChanged: () => Promise<void> | void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isGap = candidate.origin === "DRAFT_GAP";
  const scope = candidate.scope === "PRODUCT" && candidate.productId ? "PRODUCT" : "ORG";
  const source = [scopeLabel(candidate.scope, candidate.productName), shortDate(candidate.createdAt)].filter(Boolean).join(" · ");

  return (
    <DecisionRow
      tone={isGap ? "blue" : "gray"}
      icon={isGap ? "question" : "chat"}
      tag={isGap ? "정보 부족" : "기준 후보"}
      source={source}
      title={candidate.content}
      line={!isGap && candidate.evidenceCount > 0 ? `과거 답변 ${candidate.evidenceCount}건` : null}
      action={
        open ? null : (
          <span className="flex items-center gap-1.5">
            <Btn size="sm" variant="ghost" disabled={busy} onClick={async () => {
              setBusy(true);
              onError(null);
              try {
                await api.dismissKnowledgeCandidate(candidate.id);
                await onChanged();
              } catch (e) {
                onError(
                  isAxiosError(e) && e.response?.status === 409
                    ? "이미 처리한 항목"
                    : "처리 실패 · 다시 시도",
                );
              } finally {
                setBusy(false);
              }
            }}>
              {COPY.defer}
            </Btn>
            <Btn size="sm" variant={primary ? "solid" : "outline"} onClick={() => { onError(null); setOpen(true); }} disabled={busy}>
              {isGap ? COPY.enter : COPY.registerRule}
            </Btn>
          </span>
        )
      }
    >
      {open ? (
        <KnowledgeQuickAdd
          scope={scope}
          productId={candidate.productId}
          productName={candidate.productName}
          body={isGap ? "" : candidate.content}
          saveLabel={COPY.registerRule}
          onSave={async (value) => {
            await api.acceptKnowledgeCandidate(candidate.id, {
              title: value.title,
              content: value.body,
              variantId: value.variantId,
              ...(scope === "PRODUCT"
                ? { sourceType: value.topic as string }
                : { orgType: value.topic as string }),
            });
            setOpen(false);
            await onChanged();
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </DecisionRow>
  );
}
