import { useState } from "react";
import { isAxiosError } from "axios";
import { Btn } from "../ui/Btn";
import { Status } from "../ui/Status";
import { KnowledgeQuickAdd } from "./KnowledgeQuickAdd";
import { api } from "../../lib/apiClient";
import { scopeLabel } from "../../lib/knowledgeWords";
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
  // Only ACTIVE documents: a seller who already retired a file has answered this question.
  const unusable = documents.filter((d) => d.active && d.passages === 0);

  if (gaps.length === 0 && repeats.length === 0 && unusable.length === 0) {
    return <p className="break-keep text-sm text-muted">지금 확인하실 항목은 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-5" data-testid="knowledge-inbox">
      {error ? <p className="break-keep text-sm text-bad" role="alert">{error}</p> : null}

      {gaps.length > 0 ? (
        <Group
          title="정보 필요"
          hint="답변을 만들다가 회사의 기준을 찾지 못한 것입니다."
          testId="knowledge-inbox-gaps"
        >
          {gaps.map((candidate) => (
            <CandidateRow key={candidate.id} candidate={candidate} onChanged={onChanged} onError={setError} />
          ))}
        </Group>
      ) : null}

      {repeats.length > 0 ? (
        <Group
          title="확인할 후보"
          hint="과거 고객 응답에서 반복된 문장입니다. 운영 기준으로 등록할지 확인해 주세요."
          testId="knowledge-inbox-candidates"
        >
          {repeats.map((candidate) => (
            <CandidateRow key={candidate.id} candidate={candidate} onChanged={onChanged} onError={setError} />
          ))}
        </Group>
      ) : null}

      {unusable.length > 0 ? (
        <Group
          title="자료 문제"
          hint="읽을 내용이 없어 답변에 인용할 수 없는 자료입니다."
          testId="knowledge-inbox-documents"
        >
          {unusable.map((document) => (
            <li key={document.sourceId} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="break-keep text-base text-ink">{document.fileName ?? document.title}</span>
                <span className="break-keep text-sm text-muted">
                  {scopeLabel(document.scope, document.productName)} · 읽을 내용 없음
                </span>
              </div>
              <Btn
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api.setKnowledgeDocumentActive(document.sourceId, false);
                    await onChanged();
                  } catch {
                    setError("자료 상태를 바꾸지 못했습니다.");
                  }
                }}
              >
                사용 중지
              </Btn>
            </li>
          ))}
        </Group>
      ) : null}
    </div>
  );
}

function Group({
  title,
  hint,
  testId,
  children,
}: {
  title: string;
  hint: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="break-keep text-sm font-semibold text-ink">{title}</p>
      <p className="break-keep text-sm text-muted">{hint}</p>
      <ul className="mt-1 flex flex-col divide-y divide-line" data-testid={testId}>
        {children}
      </ul>
    </div>
  );
}

/**
 * One thing waiting, with the way to settle it right there.
 *
 * <p>A gap's text is a question and a repeat's text is an answer, so the same row reads them
 * differently: the question is stated and the editor opens empty; the sentence is quoted and the
 * editor opens holding it.
 */
function CandidateRow({
  candidate,
  onChanged,
  onError,
}: {
  candidate: KnowledgeCandidateView;
  onChanged: () => Promise<void> | void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isGap = candidate.origin === "DRAFT_GAP";
  const scope = candidate.scope === "PRODUCT" && candidate.productId ? "PRODUCT" : "ORG";

  return (
    <li className="flex flex-col gap-1 py-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Status tone="neutral">{scopeLabel(candidate.scope, candidate.productName)}</Status>
        {candidate.evidenceCount > 0 ? <span>과거 답변 {candidate.evidenceCount}건에서 반복</span> : null}
      </p>
      <p className="whitespace-pre-wrap break-keep text-base leading-relaxed text-ink">
        {candidate.content}
      </p>

      {open ? (
        <KnowledgeQuickAdd
          scope={scope}
          productId={candidate.productId}
          productName={candidate.productName}
          // A gap opens EMPTY: its stored text is the question, and a question is never an answer.
          body={isGap ? "" : candidate.content}
          saveLabel="답변 기준으로 등록"
          onSave={async (value) => {
            await api.acceptKnowledgeCandidate(candidate.id, {
              title: value.title,
              content: value.body,
              // Carried since Knowledge Gap Continuity v1 — `accept` is the one write that files the
              // fact and closes this exact row, so it has to be able to carry everything the editor
              // asks for. Before that the 규격 control was hidden here rather than dropped silently.
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
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <Btn size="sm" onClick={() => { onError(null); setOpen(true); }} disabled={busy}>
            {isGap ? "답변 기준 추가" : "답변 기준으로 등록"}
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              onError(null);
              try {
                await api.dismissKnowledgeCandidate(candidate.id);
                await onChanged();
              } catch (e) {
                onError(
                  isAxiosError(e) && e.response?.status === 409
                    ? "이미 처리한 항목입니다."
                    : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            아니요
          </Btn>
        </div>
      )}
    </li>
  );
}
