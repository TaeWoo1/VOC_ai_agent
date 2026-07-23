// Pure presentation helpers for operator attention signals: severity → Tailwind
// style and a defensive client-side severity sort. Kept out of the component so the
// mapping/ordering can be unit-tested without a DOM (the backend already ranks
// signals; this guards against an unsorted payload and centralizes the styling).

import type { AttentionSignal, SpikeComparison } from "./types";

export interface SeverityStyle {
  /** Badge background + text color classes. */
  badge: string;
  /** Short Korean severity label. */
  label: string;
}

const SEVERITY_STYLE: Record<string, SeverityStyle> = {
  HIGH: { badge: "bg-bad/10 text-bad", label: "높음" },
  MEDIUM: { badge: "bg-warn/10 text-warn", label: "보통" },
  LOW: { badge: "bg-ink/5 text-muted", label: "낮음" },
};

/** Most-urgent first; unknown severities rank last. */
const SEVERITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Style for a severity; unknown values fall back to the LOW (muted) style. */
export function severityStyle(severity: string): SeverityStyle {
  return SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.LOW;
}

/**
 * How many reviews currently need a look — the minimal honest review-ops number the operator can
 * see after an acquisition run, derived from the attention summary the backend already serves. No
 * new endpoint, no new field, no client-side taxonomy.
 *
 * The rule is deliberately narrow and made of values the BACKEND declares, not ones we invent:
 * a signal counts when its `sourceType` is `REVIEW` **and** its severity is HIGH or MEDIUM. That
 * excludes `NEW_REVIEW` (routine arrival, always LOW — "collected" is not "needs a look") and
 * excludes the `RECENT_*_SPIKE_CANDIDATE` volume signals, which describe the same rows a
 * rating signal already counts.
 *
 * **Honest limitation.** This is a sum of signal counts, not a proven count of distinct reviews.
 * For the ingested-review source the surviving signals are the LOW_RATING_REVIEW severities, which
 * partition rows by rating and therefore cannot overlap — but that is a property of today's
 * signals, not a guarantee of the taxonomy. If a future REVIEW signal can cover a row a rating
 * signal also covers, this number would double-count it, and the copy that renders it must not be
 * strengthened into a distinctness claim.
 */
// FE-owned copy for a scope whose attention state SellerOps cannot safely determine. Returning null
// means the scope is COVERED and the normal empty/`items` rendering applies. The copy deliberately
// says "안전하게 판단할 수 없어요" — never "확인할 일이 없어요" — so a false calm can never render.
export function attentionUncertaintyCopy(
  coverage: string,
): { headline: string; detail: string } | null {
  switch (coverage) {
    case "UNCERTAIN_MULTI_ACCOUNT":
      return {
        headline: "이 채널의 확인 상태를 안전하게 판단할 수 없어요.",
        detail:
          "한 채널에 판매 계정이 여러 개 연결되어 있어, 리뷰를 어느 계정의 것으로 볼지 지금은 구분할 수 없습니다. 그래서 '확인이 필요한 리뷰'를 정확히 셀 수 없어요 — 아무 일도 없다는 뜻이 아닙니다.",
      };
    case "UNCERTAIN_UNSUPPORTED_CHANNEL":
      return {
        headline: "이 채널의 리뷰 확인 상태는 아직 지원하지 않아요.",
        detail:
          "이 채널의 리뷰는 수집되더라도 아직 '확인할 일'로 분석하지 않습니다. 비어 있는 것은 확인이 끝났다는 뜻이 아니라, SellerOps가 아직 판단하지 않는다는 뜻입니다.",
      };
    default:
      return null; // COVERED — an empty list here honestly means nothing needs a look.
  }
}

export function reviewsNeedingAttention(items: readonly AttentionSignal[]): number {
  return items
    .filter((s) => s.sourceType === "REVIEW")
    .filter((s) => s.severity === "HIGH" || s.severity === "MEDIUM")
    .filter((s) => !s.type.endsWith("_SPIKE_CANDIDATE"))
    .reduce((total, s) => total + (Number.isFinite(s.count) ? s.count : 0), 0);
}

/** Stable sort by severity (HIGH → LOW); does not mutate the input. */
export function sortBySeverity(items: AttentionSignal[]): AttentionSignal[] {
  return [...items].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
  );
}

// --- Recent-volume spike candidates (RECENT_*_SPIKE_CANDIDATE) ---
// Distinct from the routine NEW_REVIEW/NEW_INQUIRY signals: the count is not merely
// "new", it is notably higher than the immediately preceding equal-length window. We
// give these a brand accent + a short "급증 후보" tag so the seller can tell a volume
// jump apart from normal new activity at a glance. Type-driven only — no new API field.

const SPIKE_TYPES = new Set(["RECENT_REVIEW_SPIKE_CANDIDATE", "RECENT_INQUIRY_SPIKE_CANDIDATE"]);

/** True for the recent review/inquiry volume-spike candidate signal types. */
export function isSpikeSignal(type: string): boolean {
  return SPIKE_TYPES.has(type);
}

export interface SpikeStyle {
  /** Short Korean tag marking a recent volume spike candidate. */
  tag: string;
  /** Concise hover hint explaining the tag (operator-safe, no data). */
  hint: string;
  /** Chip background + text classes for the tag. */
  chip: string;
  /** Row accent classes that set a spike card apart from routine signals. */
  card: string;
}

/** Distinct visual treatment for spike-candidate signals (brand accent). */
export const SPIKE_STYLE: SpikeStyle = {
  tag: "급증 후보",
  hint: "직전 같은 기간보다 건수가 크게 늘어 확인이 필요한 후보입니다.",
  chip: "bg-brand/10 text-brand-700",
  card: "border-l-4 border-brand bg-brand/5 pl-3",
};

// Drill-down action label. Routine signals use the generic "보기"; spike candidates
// get a source-specific call to action so the next step ("which rows drove the jump?")
// is explicit rather than decorative. Open-label only — the close label stays "닫기".
export function signalActionLabel(type: string): string {
  if (type === "RECENT_INQUIRY_SPIKE_CANDIDATE") return "어떤 문의인지 확인";
  if (type === "RECENT_REVIEW_SPIKE_CANDIDATE") return "어떤 리뷰인지 확인";
  return "보기";
}

/** Ratio at one decimal, dropping a trailing ".0" (2 → "2", 2.6667 → "2.7"). */
function formatRatio(ratio: number): string {
  const rounded = Math.round(ratio * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// Concise quantified "what changed" line for a spike, built from the structured
// fields only (never parsed from `description`). e.g. "직전 동일 기간 대비 +5건 · 2.7배".
export function spikeComparisonText(spike: SpikeComparison): string {
  const delta = spike.deltaCount.toLocaleString("ko-KR");
  return `직전 동일 기간 대비 +${delta}건 · ${formatRatio(spike.ratio)}배`;
}
