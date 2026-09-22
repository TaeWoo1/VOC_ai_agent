import type { ReactNode } from "react";
import type { ReviewTriageTier } from "../../lib/types";
import { TRIAGE_CORRECTION_COPY, TRIAGE_CORRECTION_LABEL, TRIAGE_TIERS } from "../../lib/reviewTriage";

/* Small pieces of the 리뷰 record, shared by the record and its detail (moved from the retired `ChannelReviews`). */

/**
 * `word` + the particle that fits its last syllable — 리뷰를 / 상품평을. Hangul syllables encode the
 * final consonant in their code point; anything else (Latin, digits) takes the vowel form.
 */
export function josa(word: string, afterConsonant: string, afterVowel: string): string {
  const last = word.charCodeAt(word.length - 1);
  const hangul = last >= 0xac00 && last <= 0xd7a3;
  const hasBatchim = hangul && (last - 0xac00) % 28 !== 0;
  return `${word}${hasBatchim ? afterConsonant : afterVowel}`;
}

export function parseTierParam(value: string | null): ReviewTriageTier | null {
  return value !== null && (TRIAGE_TIERS as string[]).includes(value) ? (value as ReviewTriageTier) : null;
}

/**
 * The seller's own tier on a queue row — quiet, and prefixed so it cannot be mistaken for the
 * system's chip beside it.
 *
 * Deliberately not `TRIAGE_TIER_CLASS`: 확인 필요 is emphasised there because it is what the worklist
 * is ordered by, and a correction does not reorder anything. Emphasising it would make the row look
 * like it had moved.
 */
export function SellerCorrectionChip({ tier }: { tier: ReviewTriageTier }) {
  return (
    <span className="inline-flex items-center rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted">
      {TRIAGE_CORRECTION_COPY.sellerPrefix} {TRIAGE_CORRECTION_LABEL[tier]}
    </span>
  );
}

export function formatDateTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** One segment of a segmented control — the same shape the sort control and the home window control use. */
export function SegmentBtn({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-[36px] rounded-md px-3 text-sm font-semibold tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${
        pressed ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
