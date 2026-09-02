import { useState } from "react";
import { MoreRows, useHeadRows } from "./headRows";
import { Link } from "react-router-dom";
import type { ReviewListArtifact as ReviewList } from "../../../lib/conversation/types";
import { Status } from "../../ui/Status";
import { BtnLink } from "../../ui/Btn";
import { previewText } from "../../../lib/plainText";
import { onlySharedWord } from "../../../lib/conversation/sharedWord";
import { useConversation } from "../../../lib/conversation/ConversationProvider";
import { ArtifactCard } from "./ArtifactCard";
import { FRESHNESS_LABEL, FRESHNESS_TONE } from "./freshness";
import { asOfStatus } from "../../../lib/conversation/asOf";
import { useContinueInPanel } from "../useContinueInPanel";

/**
 * Review rows as OBJECTS, on the same terms as an inquiry row (Agentic Experience v2 §3): the
 * customer's sentence is the row, pressing it opens that review in place, and the workspace is a
 * secondary icon rather than the row's only behaviour. A review cannot be ANCHORED — the focus
 * contract names inquiries and this component must not pretend otherwise — so a press expands and
 * nothing else changes in the conversation.
 *
 * <b>A word every row shares is not a distinction.</b> 「부정」 beside all eight rows of a list the
 * seller asked for as 「별점 낮은 리뷰」 is the list's own title repeated eight times; it is said once, in
 * the caption, and stays on the row only where a list actually mixes the two.
 *
 * Underneath, ONE compact status per channel — 「네이버 · 오늘 09:12 기준」 — the last observation as a
 * fact. A channel whose state this turn already raised as a STEP is not restated here: the step card
 * says it, with the control that fixes it (`stepped`).
 */
export function ReviewListArtifact({ artifact, stepped = [], headline }: { artifact: ReviewList; stepped?: readonly string[]; headline?: string }) {
  const onOpen = useContinueInPanel("REVIEW_LIST");
  const head = useHeadRows(artifact.items.length);
  const conversation = useConversation();
  const [open, setOpen] = useState<string | null>(null);
  const selectedId = conversation?.workingSet?.selectedObject?.kind === "REVIEW"
    ? conversation.workingSet.selectedObject.id : null;
  const mixed = artifact.items.some((r) => r.negative) && artifact.items.some((r) => !r.negative);
  const allNegative = onlySharedWord(artifact.items.map((r) => (r.negative ? "부정" : "보통"))) === "부정";
  // A channel this turn raised as a STEP is dropped from the footer whatever its verdict: the card
  // above says the same state AND carries the control that changes it, so the footer line is the
  // weaker of two copies. Live: 「네이버 스마트스토어 · 확인 기록 없음」 stood under a card titled
  // 「네이버 스마트스토어 리뷰 · 확인 기록 없음」. Channels with no step keep their as-of line.
  const raised = new Set(stepped.map((c) => c.toUpperCase()));
  const freshness = artifact.freshness.filter((f) => !raised.has(f.channelCode.toUpperCase()));
  const note = [artifact.note, allNegative ? "모두 부정 리뷰입니다." : null].filter(Boolean).join(" ") || null;
  return (
    <ArtifactCard title={artifact.title} note={note} headline={headline} titleSaid={artifact.titleSaid}>
      {artifact.items.length === 0 ? (
        <p className="px-4 pb-2 text-sm text-muted">보여드릴 리뷰 행이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {artifact.items.slice(0, head.shown).map((r) => {
            const expanded = open === r.reviewId;
            const selected = selectedId === r.reviewId;
            const text = r.preview ? previewText(r.preview) : "별점만";
            return (
              <li key={r.reviewId} className={selected ? "bg-brand-50/60" : ""}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen((prev) => (prev === r.reviewId ? null : r.reviewId));
                    void conversation?.selectEntity({ reviewId: r.reviewId });
                  }}
                  aria-expanded={expanded}
                  aria-current={selected ? "true" : undefined}
                  className="block w-full px-4 py-2.5 text-left transition hover:bg-canvas/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
                  data-testid="review-row-select"
                >
                  <div className="flex items-start gap-2">
                    {/* The customer's sentence IS the row, and when the row is open it is the largest
                        text in the turn — the same rule the inquiry row follows. */}
                    <p className={`min-w-0 flex-1 break-keep font-semibold leading-snug text-ink ${expanded ? "text-lg leading-relaxed" : "text-base line-clamp-2"}`}>
                      {text}
                    </p>
                    {r.rating != null ? <span className="shrink-0 text-sm tabular-nums text-muted">★ {r.rating}</span> : null}
                    {mixed && r.negative ? <Status tone="bad" variant="word">부정</Status> : null}
                  </div>
                  <p className="mt-0.5 break-keep text-sm text-muted">
                    {[r.productName, r.channelNameKo, r.writtenOn].filter(Boolean).join(" · ")}
                  </p>
                </button>
                {expanded ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line/60 bg-canvas/60 px-4 py-2.5" data-testid="review-row-detail">
                    <BtnLink to={r.to} variant="outline" size="sm" onClick={onOpen}>리뷰 화면에서 열기</BtnLink>
                    {r.productId ? (
                      <Link to={`/products/${r.productId}`} onClick={onOpen} className="text-sm text-muted hover:text-ink hover:underline">
                        상품 보기
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <MoreRows hidden={head.hidden} noun="리뷰" onExpand={head.expand} />
      {freshness.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line/70 px-4 py-2 text-sm text-muted" aria-label="채널별 확인 기준">
          {freshness.map((f) => {
            const name = f.channelNameKo ?? f.channelCode;
            const observed = f.verdict === "FRESH" || f.verdict === "UNPROVEN" || f.verdict === "NOT_COLLECTED";
            return (
              <li key={f.channelCode} className="flex items-center gap-1.5">
                {observed ? (
                  <span className={f.verdict === "FRESH" ? undefined : "text-warn"}>{asOfStatus(name, f.lastSuccessfulSyncAt)}</span>
                ) : (
                  <>
                    <span>{name}</span>
                    <Status tone={FRESHNESS_TONE[f.verdict]} variant="word">{FRESHNESS_LABEL[f.verdict]}</Status>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {artifact.more ? (
        <p className="px-4 py-2">
          <Link to={artifact.more.to} onClick={onOpen} className="text-sm font-semibold text-brand-700 hover:underline">{artifact.more.label}</Link>
        </p>
      ) : null}
    </ArtifactCard>
  );
}
