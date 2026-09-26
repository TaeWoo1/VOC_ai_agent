import { Chip } from "../../ui/Chip";
import { usePaneDepth } from "../../workspace/CaseLayout";
import { Disclosure } from "../../ui/Disclosure";
import { AiMarkChip, TriageTierChip } from "../TriageTierChip";
import { TRIAGE_TAG_DISCLOSURE } from "../../../lib/reviewTriage";
import { plainText } from "../../../lib/plainText";
import type { ChannelReviewDetailView } from "../../../lib/types";

/**
 * <b>What the problem is, and why it is in front of you</b> — the first two questions of the Decision
 * Workspace, answered in one block.
 *
 * <b>The customer's sentence is the largest text on the page.</b> It was not, before: the reply task
 * screen opened on a draft and folded the customer away under 「이 리뷰의 자동 분류」, which is the
 * right fold for a screen whose only question is «approve this text» and the wrong one for a screen
 * whose question is «is this worth your hands». A seller cannot decide what to do about a complaint
 * they have to expand to read.
 *
 * <b>The tier and the reason are shown, not folded.</b> They are the answer to 「왜 확인해야 하는가」 —
 * the second question — and the one thing kept behind a fold is the keyword classification, whose
 * accuracy has never been measured and which the disclosure says so about.
 *
 * <b>Nothing here is composed by this component.</b> The reason sentence is the backend's
 * (`ReviewTriageNote`), the recommended action is null for 참고 and renders as nothing rather than as
 * a reassuring filler, and the body is the server's redacted full text.
 */
export function ReviewProblemCard({
  detail,
  word,
  showBody = true,
}: {
  detail: ChannelReviewDetailView;
  word: string;
  /**
   * False when the screen already prints the customer's sentence as its title (CaseLayout, UI/UX v2 Phase 1): a
   * one-line review would otherwise be read twice, one block apart, and the second copy is the one that is skipped.
   */
  showBody?: boolean;
}) {
  const body = detail.body ? plainText(detail.body) : "";
  // <b>In a preview the state and the reason are one line, and the reason has no rule beside it.</b> The left
  // border was a card's edge in a 440px column that is already a card; Linear's Peek answers 「what state is
  // this in」 with a coloured mark and a word flowing beside the rest, and nothing is drawn around it.
  const preview = usePaneDepth() === "preview";
  return (
    <section aria-label="고객이 남긴 내용" className={preview ? "space-y-1.5" : "space-y-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <TriageTierChip tier={detail.triage.tier} />
        {detail.aiMark ? <AiMarkChip /> : null}
        {detail.isNew ? <Chip tone="accent">새 {word}</Chip> : null}
        {/* <b>State and criterion on one line.</b> Linear's Peek answers 「what state is this in」 with a mark,
            a word and whatever qualifies it, flowing — 「● In Review · No priority」. `triage.reason` is what the
            rules cited (here: 「1점」) and it is the whole of the why; nothing richer is invented for it. */}
        {preview && detail.triage.reason ? (
          <>
            <span aria-hidden="true" className="text-sm text-muted">
              ·
            </span>
            <span className="break-keep text-sm text-muted">{detail.triage.reason}</span>
          </>
        ) : null}
      </div>

      {/* The customer's own words. `lg` — larger than the page's prose, because this is the object the
          seller opened the screen to read. A textless review says what it is rather than implying that
          reviewnary lost something. */}
      {!showBody ? null : detail.textless || body.length === 0 ? (
        <p className="break-keep text-base leading-relaxed text-muted">별점만 남긴 {word}입니다.</p>
      ) : (
        <p className="whitespace-pre-wrap break-keep text-lg leading-relaxed text-ink">{body}</p>
      )}
      {detail.bodyRedacted ? (
        <p className="break-keep text-sm text-muted">
          개인정보로 보이는 부분은 가려서 보여드립니다. 원문은 판매자센터에서 확인하실 수 있습니다.
        </p>
      ) : null}

      {/* Why it is here. The tier was decided by the rating and whether there is text, and by nothing
          else; the reason cites what else the row carries. */}
      {/* <b>The recommended action is the full case's.</b> In a preview it stood at the same weight as the
          customer's sentence and the judgment line, and it answers 「what should I do」 — the question the one CTA
          exists to open, not the one 「should I open this」 needs. The page below renders it unchanged. */}
      {preview ? null : (
        <div className="space-y-1 border-l-2 border-line pl-3">
          <p className="break-keep text-sm text-muted">{detail.triage.reason}</p>
          {detail.triage.recommendedAction ? (
            <p className="break-keep text-sm leading-relaxed text-ink">{detail.triage.recommendedAction}</p>
          ) : null}
        </div>
      )}

      {detail.triage.tags.length > 0 ? (
        <Disclosure label="자동 분류" note={detail.triage.tags.join(" · ")}>
          <p className="break-keep px-2 pb-2 text-sm leading-relaxed text-muted">{TRIAGE_TAG_DISCLOSURE}</p>
        </Disclosure>
      ) : null}
    </section>
  );
}
