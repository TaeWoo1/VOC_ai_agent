import type { SummaryArtifact as Summary } from "../../../lib/conversation/types";

/**
 * A plain answer is prose, not a card (Conversation Core v1): SUMMARY lines read as part of the
 * assistant's own turn — a quiet title, then the sentences. Object artifacts (lists, drafts,
 * approvals) keep their containers; a paragraph never earns one.
 */
export function SummaryArtifact({ artifact }: { artifact: Summary }) {
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
