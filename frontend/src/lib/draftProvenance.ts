/**
 * <b>Who wrote the version on screen, and what the section may therefore be called.</b>
 *
 * Pilot QA pass 1 (2026-09-06) found the inquiry panel heading 「AI가 준비한 답변」 standing over a
 * version the SELLER had written. On the live org the model's v1 ended
 * 「추가 정보 주시면 최대한 정확히 추천드리겠습니다」 and the seller's v2 replaced that sentence with
 * 「전화로 문의 주시면 바로 확인해 드리겠습니다」 — a support channel no registered knowledge mentions.
 * The stored row said `author_kind = SELLER`; the screen simply never read it, so the seller's own
 * sentence was presented back to them as the assistant's work.
 *
 * That is the failure `Agent.tsx`'s `draftKindLabel` already names in its docblock — "calling a
 * template AI" — for the OTHER seam (a run's provenance). This is the same rule for the seam the
 * inquiry screen reads: the append-only draft ledger's own `authorKind`.
 *
 * <b>Nothing is derived.</b> The word comes from the stored value; an author this build does not
 * know gets the neutral heading and no claim about who wrote it, because a version whose author we
 * cannot name is not a version we may attribute.
 */

/** The author kinds the draft ledger records. `null` = no version yet, or one written before v1. */
export type DraftAuthor = "MODEL" | "RULE" | "SELLER" | "SELLER_APPROVED_FALLBACK" | null | undefined;

/** The neutral name for the answer section — used whenever nothing may be attributed to the AI. */
const NEUTRAL_HEADING = "답변 초안";

/**
 * The heading for the answer section.
 *
 * `null` (nothing written yet) keeps 「AI가 준비한 답변」: the section is about to offer exactly that,
 * and the sentence under it describes what the button will do. Once a version exists the heading
 * names the version's author instead.
 */
export function draftSectionHeading(author: DraftAuthor, hasDraft: boolean): string {
  if (!hasDraft) return "AI가 준비한 답변";
  switch (author) {
    case "MODEL":
      return "AI가 준비한 답변";
    case "SELLER":
      return "내가 쓴 답변";
    case "SELLER_APPROVED_FALLBACK":
      return "등록한 안내 문구";
    // A rule-written version is not AI, and saying so is the whole point of this file.
    case "RULE":
      return NEUTRAL_HEADING;
    default:
      return NEUTRAL_HEADING;
  }
}

/**
 * The provenance line: which version this is and who wrote it.
 *
 * Returns `null` when the author is unknown — the version number alone is already shown where the
 * ledger matters, and inventing an author for it would be the defect this file exists to stop.
 */
export function draftProvenanceLine(author: DraftAuthor, version: number | null | undefined): string | null {
  if (version == null) return null;
  const who = author === "MODEL" ? "AI 작성"
    : author === "SELLER" ? "판매자 수정"
      : author === "SELLER_APPROVED_FALLBACK" ? "판매자가 등록한 문구"
        : author === "RULE" ? "기본 문구"
          : null;
  return who ? `버전 ${version} · ${who}` : `버전 ${version}`;
}
