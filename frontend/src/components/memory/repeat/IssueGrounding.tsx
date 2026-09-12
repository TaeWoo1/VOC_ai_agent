import { Link } from "react-router-dom";
import {
  knowledgeGapAction,
  knowledgeLine,
  knowledgeScopeLine,
} from "../../../lib/repeatedIssue";
import type { IssueKnowledgeOnHand } from "../../../lib/types";

/**
 * <b>우리가 이 문제에 대해 써 둔 것</b> — what the company's own library already says.
 *
 * <b>It answers what exists, never whether it is good enough.</b> Whether a registered guidance
 * actually answers a customer is the drafting lane's question and costs model calls; opening a
 * repeated problem must not. So this block reports counts and the seller's own sentences, and stops.
 *
 * <b>The three states are kept apart on purpose.</b> An empty library, a library that holds things
 * none of which name this problem, and a library that answers it lead to three different next steps
 * — and telling a seller who has already written the answer to go write it is the failure this
 * separation exists to prevent.
 */
export function IssueGrounding({
  knowledge,
  failed,
}: {
  knowledge: IssueKnowledgeOnHand | null;
  failed: boolean;
}) {
  if (failed || !knowledge) return null;

  const scope = knowledgeScopeLine(knowledge);
  const action = knowledgeGapAction(knowledge);

  return (
    <section aria-label="우리가 써 둔 것">
      <h3 className="text-base font-bold text-ink">우리가 써 둔 것</h3>
      <p className="mt-2 break-keep leading-relaxed text-ink">{knowledgeLine(knowledge)}</p>
      {scope ? <p className="mt-1 break-keep text-sm leading-relaxed text-muted">{scope}</p> : null}

      {knowledge.excerpts.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {knowledge.excerpts.map((excerpt) => (
            // The seller's own sentence, bounded by the read. Quoted so it is plainly theirs and not
            // something this screen composed.
            <li key={excerpt} className="break-keep rounded-xl bg-canvas p-3 text-sm leading-relaxed text-ink">
              「{excerpt}」
            </li>
          ))}
        </ul>
      ) : null}

      {action ? (
        <p className="mt-3">
          <Link
            to="/knowledge"
            className="rounded font-semibold text-brand-700 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            {action}
            <span className="ml-1" aria-hidden="true">›</span>
          </Link>
        </p>
      ) : null}
    </section>
  );
}
