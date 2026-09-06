/**
 * <b>Matching a problem NAME the seller said to the problems this org actually has.</b>
 *
 * <p>One matcher, shared by the two tool adapters that expose `search_review_issues`, so a subject can
 * never mean one thing to the issue subgraph and another to the Operator.
 *
 * <p><b>Literal, not fuzzy.</b> A row matches when its title and the seller's span contain one another
 * once whitespace is removed — 「접착 부족」 finds 접착 부족 exactly, and 「접착」 finds all three 접착
 * problems, which is the honest answer to a question that named only half a title. Nothing is scored,
 * nothing is stemmed, and no synonym table exists: a dictionary here would let the runtime decide that
 * two of the seller's own problem names mean the same thing.
 *
 * <p><b>An empty result is a result.</b> The caller must say 「그런 이름의 반복 문제는 없습니다」 and must
 * not fall back to the top of the list — answering a question about a problem that does not exist with
 * the biggest problem that does is the defect this file was written for.
 */
import type { ReviewIssueSummary } from "../spring/types";

const squeeze = (s: string) => s.replace(/\s+/gu, "").toLowerCase();

/**
 * The rows this subject names — every row when the subject is empty.
 *
 * <p>When more than one title matches, a title that another matched title CONTAINS is dropped: a seller
 * who says 「접착 부족」 over an org holding both 접착 and 접착 부족 named the longer one, and offering
 * them the choice would be asking a question they already answered.
 */
export function narrowIssuesBySubject<T extends ReviewIssueSummary>(
  rows: readonly T[],
  subject: string | null | undefined,
): T[] {
  const needle = squeeze(subject ?? "");
  if (needle.length === 0) return [...rows];
  const matched = rows.filter((row) => {
    const title = squeeze(row.title ?? "");
    return title.length > 0 && (title.includes(needle) || needle.includes(title));
  });
  if (matched.length < 2) return matched;
  return matched.filter((row) => {
    const title = squeeze(row.title ?? "");
    return !matched.some((other) => other !== row && squeeze(other.title ?? "").includes(title)
      && squeeze(other.title ?? "").length > title.length);
  });
}
