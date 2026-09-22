import type { ChannelDataState } from "../../lib/types";

/**
 * The one place the six coverage states become Korean.
 *
 * <b>The vocabulary is not re-derived per screen.</b> Every component that needed to say something
 * about a channel's data used to phrase it itself, which is how "네이버 문의 0건" gets written by a
 * component nobody reviewed for that. The backend decides the state; this decides its words; nothing
 * else does either.
 *
 * <b>`ZERO` is the only state that may say "없습니다".</b> The other five all mean "we do not know",
 * and the difference between them is only the remedy.
 */
const LABEL: Record<ChannelDataState, string> = {
  OBSERVED_FRESH: "최신",
  OBSERVED_FRESHNESS_UNPROVEN: "최신 여부 미확인",
  ZERO: "0건",
  NOT_SUPPORTED: "수집 경로 없음",
  NOT_CONNECTED: "연결 안 됨",
  BLOCKED: "연결 끊김",
};

/**
 * Tone, and the deliberate absence of green for anything but a proven read.
 *
 * `OBSERVED_FRESH` is the only state that earns the affirmative colour, because it is the only one
 * that means the number beside it was measured recently. Painting "최신 여부 미확인" green would make
 * the caveat decorative.
 */
const TONE: Record<ChannelDataState, string> = {
  OBSERVED_FRESH: "bg-good/10 text-good",
  OBSERVED_FRESHNESS_UNPROVEN: "bg-warn/10 text-warn",
  ZERO: "bg-canvas text-muted",
  NOT_SUPPORTED: "bg-canvas text-muted",
  NOT_CONNECTED: "bg-canvas text-muted",
  BLOCKED: "bg-bad/10 text-bad",
};

/** True when a zero shown beside this state would be a claim the data cannot support. */
export function cannotProveAbsence(state: ChannelDataState): boolean {
  return state !== "ZERO";
}

/** True when rows from this state may be shown at all (with their own dates). */
export function hasObservations(state: ChannelDataState): boolean {
  return state === "OBSERVED_FRESH" || state === "OBSERVED_FRESHNESS_UNPROVEN";
}

export function dataStateLabel(state: ChannelDataState): string {
  return LABEL[state];
}

/**
 * The state, optionally named for the thing it is about.
 *
 * <b>The label is not optional in practice.</b> Three unlabelled badges in a row tell a reader that
 * something is fresh and something is broken, and nothing about which. Wherever more than one state
 * appears together, each must say what it is a verdict on.
 */
export function DataStateBadge({ state, label }: { state: ChannelDataState; label?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium ${TONE[state]}`}>
      {label ? <span className="font-normal">{label}</span> : null}
      {LABEL[state]}
    </span>
  );
}
