import type { SummaryArtifact as Summary } from "../../../lib/conversation/types";

/**
 * A plain answer is prose, not a card (Conversation Core v1): SUMMARY lines read as part of the
 * assistant's own turn — a quiet title, then the sentences. Object artifacts (lists, drafts,
 * approvals) keep their containers; a paragraph never earns one.
 */
export function SummaryArtifact({ artifact, headline }: { artifact: Summary; headline?: string }) {
  // <b>A block that only repeats the sentence above it is not a summary</b> (Agentic Experience v2 §6).
  // Live: 「어느 채널에 대한 질문인지 알려주세요」 was the turn's own sentence AND a titled block under it
  // saying the same words — the seller reads one clarification twice and looks for the difference.
  // Only an exact restatement is dropped; a block with anything of its own is drawn in full.
  if (headline && artifact.lines.length > 0 && artifact.lines.every((line) => headline.includes(line.trim()))) return null;
  return (
    <section aria-label={artifact.title} className="space-y-1">
      <p className="break-keep text-sm font-semibold text-muted">{artifact.title}</p>
      {artifact.note ? <p className="break-keep text-sm text-muted">{artifact.note}</p> : null}
      <ul className="space-y-1">
        {artifact.lines.map((line, i) => (
          <li key={i} className="break-keep text-base leading-relaxed text-ink">{line}</li>
        ))}
      </ul>
    </section>
  );
}
