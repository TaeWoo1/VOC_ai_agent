import { Section, ListBox } from "../../ui/Section";
import { usePaneDepth } from "../../workspace/CaseLayout";
import { DECISION_LOG_DISCLOSURE, decisionLogSentence } from "../../../lib/reviewDecision";
import { kstDate } from "../../../lib/format";
import type { ReviewDecisionLogEntry } from "../../../lib/types";

/**
 * <b>기록</b> — the eighth and last block: what has already been decided about this review.
 *
 * <b>No new table stands behind it.</b> Every line is read from a trail this product has been writing
 * for months and nobody was reading: the seller's corrections, the response decision, the explicit
 * acts, the reply approval, the reported outcome. That is why a refresh does not lose anything on this
 * screen — none of it ever lived in the browser.
 *
 * <b>Newest first.</b> The question the log answers HERE is «where does this stand», and the answer is
 * the last thing that happened. The trails themselves still read oldest-first where the history is the
 * subject rather than the footnote.
 *
 * <b>An entry this build cannot name is not drawn.</b> The server's vocabulary may grow ahead of the
 * screen, and a row rendered as its own raw token is exactly the internal-word leak this product
 * removes everywhere else.
 *
 * <b>Empty is a real state and says so.</b> A review nobody has decided has no history, and inventing
 * a 「판단 전」 event would put a decision in the trail that nobody made.
 */
export function DecisionLog({ entries, failed }: { entries: ReviewDecisionLogEntry[]; failed: boolean }) {
  const preview = usePaneDepth() === "preview";
  if (failed) return null;

  const rows = entries
    .map((entry) => ({ entry, sentence: decisionLogSentence(entry) }))
    .filter((row): row is { entry: ReviewDecisionLogEntry; sentence: string } => row.sentence !== null);

  // <b>The preview does not draw the log.</b> Its answer — where this review stands — is one sentence there
  // (`previewJudgmentSentence`), composed from the same `decisionLogSentence` this block uses, and the whole
  // trail is one press away on the case the docked action opens.
  if (preview) return null;

  return (
    <Section title="기록" count={rows.length > 0 ? rows.length : null}>
      {rows.length === 0 ? (
        <p className="break-keep text-sm leading-relaxed text-muted">아직 이 리뷰에 기록된 판단이 없습니다.</p>
      ) : (
        <ListBox>
          <ul>
            {rows.map(({ entry, sentence }, index) => (
              <li
                key={`${entry.kind}-${entry.at}-${index}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <span className="break-keep text-sm text-ink">{sentence}</span>
                <span className="shrink-0 text-sm tabular-nums text-muted">{kstDate(entry.at)}</span>
              </li>
            ))}
          </ul>
        </ListBox>
      )}
      <p className="break-keep text-sm leading-relaxed text-muted">{DECISION_LOG_DISCLOSURE}</p>
    </Section>
  );
}
