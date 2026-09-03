import { useState } from "react";
import { Link } from "react-router-dom";
import { isAxiosError } from "axios";
import type { DraftEvidenceView, GeneratedReviewDraftView, ReviewKnowledgeGapView } from "../lib/types";
import { api } from "../lib/apiClient";
import { Btn } from "./ui/Btn";
import { Status } from "./ui/Status";
import { AnswerBasisQuickAdd } from "./inbox/AnswerBasisQuickAdd";

/**
 * <b>AI 답변 준비 — the grounded draft, and what it was written from</b> (Grounded Review Drafting v1).
 *
 * <p>The order on screen is the order the seller needs it in: <b>the draft first</b>, because that is
 * what they came for; then, quietly, 「왜 이렇게 썼어요?」 — the passages the drafter was actually shown,
 * with the excerpt that makes each one checkable rather than a title to take on trust; then, when
 * something is missing, the one thing they could register so the next draft can say more.
 *
 * <p><b>It writes into the editor above it and nothing else.</b> The generated version is saved by the
 * backend as an ordinary append-only version; this component hands the text to the panel it lives in
 * so the seller edits, saves and approves through exactly the controls they already use. It never
 * approves, never sends, and never touches the submission path.
 */
/**
 * Why a generation did not happen, as the seller reads it.
 *
 * <p>Two answers, because there are two situations and they call for different next steps. A 409 is
 * the review's own state — an approval stands, or it is not 대응 필요 — and the seller fixes it on
 * this screen. Anything else is the machine, and the answer is to press the button again.
 *
 * <p>Exported and pure so the mapping is checkable: the component's catch is one line over it.
 */
export function generateFailureMessage(status: number | undefined): string {
  return status === 409
    ? "승인된 답변이 있거나 '대응 필요' 상태가 아니어서 초안을 만들 수 없습니다."
    : "초안을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function GroundedReviewDraft({
  accountId,
  actionRef,
  storedEvidence,
  storedBasis,
  storedBasisNote,
  onDrafted,
}: {
  accountId: string;
  actionRef: string;
  /** The head version's stored citations — what 「왜 이렇게 썼어요?」 shows after a reload. */
  storedEvidence: DraftEvidenceView[];
  /**
   * The head version's stored basis and its sentence — what 「근거 있음 / 기본 문구」 says after a
   * reload (Retrieval Runtime Closure v1 §1). Both null when the version recorded no basis, and then
   * the line is not rendered: "not recorded" is a different statement from either basis.
   */
  storedBasis: string | null;
  storedBasisNote: string | null;
  /** Hand the generated body to the editor. Called synchronously; never awaited. */
  onDrafted: (body: string) => void;
}) {
  const [result, setResult] = useState<GeneratedReviewDraftView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);

  // What is on screen: this session's generation if there is one, else the stored head's record.
  // The stored record is what survives a reload — 「왜 이렇게 썼어요?」 has to answer the same way
  // tomorrow, and it answers from the citations the saved version carries.
  const evidence = result ? result.evidence : storedEvidence;
  const gaps = result?.knowledgeGaps ?? [];
  // The same rule as the citations above: this session's generation if there is one, else the saved
  // version's own record. The basis is the fact that decides whether the text in the editor is this
  // company's knowledge or its safe default, so it has to survive a reload — before this it did not.
  const basis = result ? result.answerBasis : storedBasis;
  const basisNote = result ? result.answerBasisNote : storedBasisNote;

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const view = await api.generateReviewReplyDraft(accountId, actionRef);
      setResult(view);
      setShowEvidence(false);
      // Hand the text over WITHOUT awaiting. What the seller is waiting for is the draft, and it is
      // in hand; whatever the panel does next to re-read its own state must not be able to hold this
      // control in 「준비하는 중…」 — measured 2026-09-03, a refresh that did not settle left the
      // button spinning over a draft that had already arrived and was already in the editor.
      onDrafted(view.draft.body);
    } catch (e) {
      setError(generateFailureMessage(isAxiosError(e) ? e.response?.status : undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="AI 답변 준비" className="flex flex-col gap-2" data-testid="grounded-review-draft">
      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" onClick={() => void generate()} disabled={busy} data-testid="grounded-review-generate">
          {busy ? "준비하는 중…" : result ? "다시 준비하기" : "AI 초안 준비"}
        </Btn>
        {/* Said where the button is: a draft is a draft, and this one is not sent by pressing it. */}
        <span className="text-sm text-muted">저장된 지식을 근거로 초안만 만듭니다.</span>
      </div>

      {error ? <p className="break-keep text-sm text-bad" role="alert">{error}</p> : null}

      {basis ? (
        <p className="flex flex-wrap items-center gap-2 text-sm" role="status" data-testid="grounded-review-basis">
          <Status tone={basis === "GROUNDED" ? "good" : "neutral"}>
            {basis === "GROUNDED" ? "근거 있음" : "기본 문구"}
          </Status>
          {basisNote ? <span className="break-keep text-muted">{basisNote}</span> : null}
        </p>
      ) : null}

      {/* An operational fact, kept apart from anything about the seller's knowledge — the budget, the
          capability, the vendor, or a promise the evidence did not support. */}
      {result?.unavailableMessage ? (
        <p className="break-keep text-sm text-warn" role="status">{result.unavailableMessage}</p>
      ) : null}

      {evidence.length > 0 ? (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setShowEvidence((open) => !open)}
            aria-expanded={showEvidence}
            className="self-start rounded-lg px-1 py-0.5 text-sm text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            data-testid="grounded-review-why"
          >
            {showEvidence ? "▾" : "▸"} 왜 이렇게 썼어요? · 근거 {evidence.length}
          </button>
          {showEvidence ? (
            <ul className="flex flex-col gap-2 border-l-2 border-line pl-3" data-testid="grounded-review-evidence">
              {evidence.map((row, i) => (
                <li key={`${row.sourceId ?? row.kind}-${i}`} className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-ink">
                    {row.scopeLabel ?? row.kind}
                    {row.title ? ` · ${row.title}` : ""}
                  </span>
                  {/* The sentence the drafter was actually shown. A title is a pointer; this is the check. */}
                  {row.snippet ? (
                    <span className="break-keep text-sm text-muted">{row.snippet}</span>
                  ) : (
                    <span className="text-sm text-muted">저장된 지식이 삭제되어 내용을 볼 수 없습니다.</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {gaps.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-canvas p-3" data-testid="grounded-review-gaps">
          <p className="break-keep text-sm font-semibold text-ink">더 정확한 답변을 위해 정보가 필요합니다.</p>
          {gaps.map((gap) => (
            <Gap key={`${gap.scope}-${gap.subject}`} gap={gap} onSaved={generate} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One ask, with the way to answer it right there.
 *
 * <p>A PRODUCT gap opens the same quick-add the inquiry screen uses — the product is known, so the
 * seller writes the sentence and nothing else. An ORG gap has no in-place form yet and links to the
 * settings screen that owns operating rules; saying so plainly beats a button that opens nothing.
 */
function Gap({ gap, onSaved }: { gap: ReviewKnowledgeGapView; onSaved: () => void | Promise<void> }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="break-keep text-sm text-ink">{gap.question}</p>
      {gap.scope === "PRODUCT" && gap.productId ? (
        <AnswerBasisQuickAdd productId={gap.productId} onSaved={onSaved} />
      ) : (
        <p className="text-sm">
          <Link to="/settings/policies" className="font-semibold text-brand-700 hover:underline">
            운영 정책에 추가하기
          </Link>
        </p>
      )}
    </div>
  );
}
