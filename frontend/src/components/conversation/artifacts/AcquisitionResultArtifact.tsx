import type { AcquisitionResultArtifact as AcquisitionResult } from "../../../lib/conversation/types";
import { count } from "../../../lib/format";
import { ArtifactCard } from "./ArtifactCard";

/** 「9월 1일」 — a date-only string as the seller reads it. Never a raw ISO in a sentence. */
function dayWord(iso: string): string {
  const [, m, d] = iso.split("-");
  if (!m || !d) return iso;
  return `${Number(m)}월 ${Number(d)}일`;
}

/**
 * The window the run covered, or null. Both ends or neither: the runtime never sends half a range, and
 * a placeholder end is exactly the sentinel this package removed from the seller's prose (§2).
 */
export function periodWord(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  return from === to ? dayWord(from) : `${dayWord(from)}~${dayWord(to)}`;
}

/**
 * <b>What the collection the seller just ran brought in</b> (Outcome Artifact v1 §1).
 *
 * This used to be five numbers inside one paragraph — 「네이버 리뷰 8월 20일~9월 2일을 확인했습니다. 새로
 * 들어온 리뷰 115건, 이미 확인한 리뷰 33건입니다.」 — a system log with a full stop after it. The two
 * seconds after a collection finishes are spent asking one question, 「무엇이 새로 들어왔나」, and prose
 * answers it in the order the sentence happens to run rather than the order the eye reads.
 *
 * So the answer is the largest thing on the card and everything else steps down: what came in, then what
 * was already held, then — only when it happened — what could not be read. The channel and the days are
 * the caption above them, because they say WHICH collection this is, not what it found.
 *
 * <b>Nothing is derived.</b> The three tallies are not added, differenced, or turned into a percentage:
 * 「115 새로 들어옴」 and 「33 이미 있던 리뷰」 are two observations, and 148 is a third that nobody made.
 * A tally the record does not hold renders nothing at all — a run that never counted is not a run that
 * brought in nothing.
 */
export function AcquisitionResultArtifact({ artifact }: { artifact: AcquisitionResult }) {
  const period = periodWord(artifact.periodStart, artifact.periodEnd);
  const figures: { label: string; value: number; tone: "lead" | "muted" | "bad" }[] = [];
  if (artifact.rowsNew != null) figures.push({ label: "새로 들어옴", value: artifact.rowsNew, tone: "lead" });
  if (artifact.rowsDuplicate != null) figures.push({ label: "이미 있던 리뷰", value: artifact.rowsDuplicate, tone: "muted" });
  // A failure is shown when there IS one. A row saying 「못 읽음 0」 is a reassurance the seller has to
  // read a number to receive, and this card is read in two seconds.
  if (artifact.rowsFailed != null && artifact.rowsFailed > 0) {
    figures.push({ label: "못 읽음", value: artifact.rowsFailed, tone: "bad" });
  }
  if (figures.length === 0 && !period) return null;
  return (
    <ArtifactCard title={artifact.title} note={artifact.note} titleSaid={artifact.titleSaid}>
      <div className="px-4 py-2.5" data-testid="acquisition-result">
        {/* WHICH collection — one quiet line. The seller pressed the button; they know they ran it. */}
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span className="font-medium text-ink">{artifact.channelNameKo}</span>
          {period ? <span className="tabular-nums" data-testid="acquisition-period">{period}</span> : null}
        </p>
        {figures.length > 0 ? (
          <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            {figures.map((f) => (
              <div key={f.label} className="flex items-baseline gap-1.5">
                <dd className={`tabular-nums ${f.tone === "lead" ? "text-2xl font-bold text-ink"
                  : f.tone === "bad" ? "text-lg font-semibold text-bad" : "text-lg font-semibold text-muted"}`}>
                  {count(f.value)}
                </dd>
                <dt className={`text-xs ${f.tone === "lead" ? "font-medium text-ink" : "text-muted"}`}>{f.label}</dt>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </ArtifactCard>
  );
}
