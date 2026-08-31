import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { InquiryDetailArtifact as InquiryDetail } from "../../../lib/conversation/types";
import { Status, type StatusTone } from "../../ui/Status";
import { Btn, BtnLink } from "../../ui/Btn";
import { api } from "../../../lib/apiClient";
import { previewText } from "../../../lib/plainText";
import { relativeTime } from "../../../lib/format";
import { useContinueInPanel } from "../useContinueInPanel";

const STATE_TONE: Record<string, StatusTone> = { "답변 필요": "warn", "답변함": "good" };

/** The prompt the primary action sends — the same sentence the conversation already understands. */
const PREPARE_PROMPT = "답변 준비해줘";

/**
 * One inquiry, inspected (Agent Interaction Model v2 §4): the customer's sentence is the biggest text,
 * the row's closed facts sit under it, and the two moves are 「답변 준비」 (a conversation sentence) and
 * the workspace link. The excerpt is transient — a reloaded thread re-reads the same inquiry's own
 * detail (READ only), exactly like a reloaded draft body.
 */
export function InquiryDetailArtifact({ artifact, onPrompt }: { artifact: InquiryDetail; onPrompt?: (prompt: string) => void }) {
  const onOpen = useContinueInPanel("INQUIRY_DETAIL");
  const [reloaded, setReloaded] = useState<string | null>(null);
  const excerpt = artifact.excerpt ?? reloaded;

  useEffect(() => {
    if (artifact.excerpt || !artifact.workItemId) return;
    let live = true;
    api.getInquiryDetailStrict(artifact.workItemId)
      .then((detail) => {
        if (live) setReloaded(detail.details ?? null);
      })
      .catch(() => {
        // The card still stands on its closed facts; the workspace link has the full text.
      });
    return () => {
      live = false;
    };
  }, [artifact.excerpt, artifact.workItemId]);

  const meta = [artifact.channelNameKo, artifact.productName].filter(Boolean).join(" · ");
  return (
    <section aria-label={artifact.title} data-testid="inquiry-detail-artifact" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Status tone={STATE_TONE[artifact.stateLabel] ?? "neutral"} variant="word">{artifact.stateLabel}</Status>
          {meta ? <span className="break-keep text-sm text-muted">{meta}</span> : null}
          {artifact.receivedAt ? <span className="text-sm tabular-nums text-muted">{relativeTime(artifact.receivedAt)}</span> : null}
        </div>
        <p className="break-keep text-base font-semibold leading-snug text-ink">{previewText(artifact.title) || "제목 없는 문의"}</p>
        {excerpt ? (
          <p className="whitespace-pre-wrap break-keep rounded-lg bg-canvas px-3 py-2 text-base leading-relaxed text-ink" data-testid="inquiry-detail-excerpt">
            {previewText(excerpt)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {artifact.actionability === "DRAFTABLE" && onPrompt ? (
            <Btn size="sm" onClick={() => onPrompt(PREPARE_PROMPT)}>답변 준비</Btn>
          ) : null}
          <BtnLink to={artifact.to} variant="outline" size="sm" onClick={onOpen}>문의 화면에서 열기</BtnLink>
          {artifact.productId && artifact.productName ? (
            <Link to={`/products/${artifact.productId}`} onClick={onOpen} className="text-sm text-muted hover:text-ink hover:underline">
              상품 보기
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
