/**
 * What each channel may be SAID about — the freshness axis, and the sentences it licenses.
 *
 * <b>Why this file exists.</b> Every cross-channel answer the Operator could give before this module
 * was built on one silent assumption: that the rows it read are the whole picture. They are not, and
 * the day that stopped being theoretical is on the record. On 2026-08-24 NAVER 문의 was live-proven on
 * two official resources — 18 REAL rows, 100% product attribution — and hours later its first routine
 * run was refused at token issuance. Both facts held at once. Asked "네이버 문의 어때?" that evening, a
 * runtime with one word for "no data" had exactly two things it could say, and both were false:
 * "네이버는 문의를 지원하지 않습니다" (disproven that morning) or a count presented as today's state.
 *
 * <b>The true sentence needs two facts, not one.</b> "수집된 이력이 있지만, 자동 수집이 멈춰 있어
 * 지금이 최신인지 확인하지 못했습니다." That sentence is impossible without a vocabulary that
 * separates *the channel does not offer this* from *this seller has not connected it* from *we have
 * rows and cannot prove they are current* from *we looked, and there are none*. That vocabulary is
 * {@link ChannelDataState}, and this module is the only place it becomes Korean.
 *
 * <b>One rule outranks the rest: absence is a claim.</b> "없습니다" asserts something about the world
 * and may be said from exactly one state — `ZERO`, which means a live routine looked and found
 * nothing. From every other state the honest answer names the gap instead. {@link mayReportAbsence}
 * is that rule as a function, and `channelCoverage.test.ts` asserts no sentence here escapes it.
 */
import type { ChannelCoverageRow, ChannelDataState } from "../../spring/types";

/** A channel's own name for a sentence — never an id, never a code the seller has not seen. */
function channelLabel(row: ChannelCoverageRow): string {
  return row.channelNameKo ?? row.channelCode;
}

/**
 * The topic particle a Korean noun takes — 은 after a final consonant, 는 otherwise.
 *
 * <b>Small, and not cosmetic.</b> These sentences are read by sellers, and "쿠팡는" is the kind of
 * seam that makes a generated answer read as generated. Channel names are the only nouns this module
 * inflects, and they come from the catalogue, so the rule is applied where the name is used rather
 * than stored twice in two forms.
 */
function topicParticle(noun: string): string {
  const last = noun.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) {
    // Not a Hangul syllable (a latin channel code, a digit). 는 is the safe default and is what a
    // reader supplies themselves for a foreign word.
    return "는";
  }
  return (code - 0xac00) % 28 === 0 ? "는" : "은";
}

/** A noun with its topic particle attached — "쿠팡은", "네이버 스마트스토어는". */
export function withTopic(noun: string): string {
  return `${noun}${topicParticle(noun)}`;
}

const DATA_TYPE_LABEL: Record<string, string> = {
  INQUIRY: "문의",
  REVIEW: "리뷰",
  ORDER_SUMMARY: "주문",
};

export function dataTypeLabel(dataType: string): string {
  return DATA_TYPE_LABEL[dataType] ?? dataType;
}

/**
 * May an answer say "없습니다" about this channel?
 *
 * <b>Only `ZERO`.</b> Every other state is a reason we cannot see, and a reason we cannot see is not
 * evidence there is nothing there. This is the same rule `AttentionCoverage.COVERED` enforces on the
 * attribution axis, applied to the freshness axis, and it is stated once so it cannot drift.
 */
export function mayReportAbsence(state: ChannelDataState): boolean {
  return state === "ZERO";
}

/** May an answer present this channel's rows as the CURRENT state? */
export function mayClaimCurrent(state: ChannelDataState): boolean {
  return state === "OBSERVED_FRESH" || state === "ZERO";
}

/** May an answer cite this channel's rows at all (with their own dates)? */
export function hasObservations(state: ChannelDataState): boolean {
  return state === "OBSERVED_FRESH" || state === "OBSERVED_FRESHNESS_UNPROVEN";
}

/**
 * The one sentence this row licenses — and no other.
 *
 * <b>Each state gets its own words because each has its own remedy.</b> "지원하지 않습니다" and
 * "연결되어 있지 않습니다" and "자동 수집이 멈춰 있습니다" send the seller to three different places;
 * a shared phrase would send them to none. The counts are the row's own and are never presented as a
 * period's intake — `newestObservedAt` is the newest row's SOURCE time, which is what makes
 * "가장 최근 것은 …" true rather than a restatement of when we looked.
 */
export function coverageSentence(row: ChannelCoverageRow): string {
  const channel = channelLabel(row);
  const label = dataTypeLabel(row.dataType);
  switch (row.state) {
    case "NOT_SUPPORTED":
      return `${withTopic(channel)} ${label} 데이터를 제공하지 않습니다 (채널 자체의 한계이며, 수집 실패가 아닙니다).`;
    case "NOT_CONNECTED":
      return `${withTopic(channel)} 아직 연결되어 있지 않아 ${label} 데이터를 확인할 수 없습니다.`;
    case "BLOCKED":
      return `${channel} 연결이 끊겨 ${label} 데이터를 확인할 수 없습니다. 채널 연결에서 다시 연결해 주세요.`;
    case "ZERO":
      return `${channel}의 ${withTopic(label)} 현재 없습니다 (자동 수집이 정상 동작 중입니다).`;
    case "OBSERVED_FRESH":
      return `${channel} ${label} ${row.rows}건${openClause(row)}.`;
    case "OBSERVED_FRESHNESS_UNPROVEN":
      return row.rows > 0
        ? `${channel} ${withTopic(label)} 수집된 이력이 있지만(${row.rows}건${newestClause(row)}), `
          + `${stalledReason(row)} 지금이 최신인지 확인하지 못했습니다.`
        : `${channel} ${withTopic(label)} ${stalledReason(row)} 아직 한 번도 수집하지 못했습니다 `
          + `— 0건이라는 뜻이 아닙니다.`;
  }
}

function openClause(row: ChannelCoverageRow): string {
  if (row.openRows == null) {
    return "";
  }
  return row.dataType === "INQUIRY"
    ? `, 그중 답변이 필요한 것 ${row.openRows}건`
    : `, 그중 부정 ${row.openRows}건`;
}

function newestClause(row: ChannelCoverageRow): string {
  return row.newestObservedAt ? `, 가장 최근 것은 ${row.newestObservedAt.slice(0, 10)}` : "";
}

/**
 * Why collection is not running, in the seller's terms.
 *
 * The distinction is the operator's own: a schedule the RUNTIME paused resumes when the channel is
 * reconnected, and one a PERSON paused does not. Reporting both as "멈춰 있습니다" would tell a seller
 * to wait for something that will never happen on its own.
 */
function stalledReason(row: ChannelCoverageRow): string {
  if (!row.supported) {
    // Rows without an automatic path — NAVER 리뷰 is the case: no review API, 4,340 stored reviews
    // acquired through an approved export. "제공하지 않습니다" would be a true sentence about the API
    // and a false one about the data, so the reason names the path rather than denying the rows.
    return "이 채널에는 자동 수집 경로가 없어";
  }
  if (!row.routineEnabled) {
    return row.routinePausedBy === "OPERATOR"
      ? "자동 수집이 꺼져 있어"
      : "자동 수집이 아직 켜져 있지 않아";
  }
  return "최근 자동 수집이 성공하지 못해";
}

/** One channel's breakdown row for a grouped answer. Identity is the channel CODE, never the label. */
export interface ChannelBreakdownRow {
  readonly channelCode: string;
  readonly label: string;
  readonly state: ChannelDataState;
  readonly rows: number;
  readonly openRows: number | null;
  readonly newestObservedAt: string | null;
  /** True when this row's number may be added into a cross-channel total. */
  readonly countable: boolean;
}

/**
 * The channel breakdown for one data type, in a stable order.
 *
 * <b>Every visible channel appears, including the ones with nothing.</b> A channel omitted from a
 * breakdown is read as a zero by any reader who counts what they were given — which is the entire
 * failure mode this module exists to prevent, reintroduced one layer up.
 *
 * <b>Scope is not breakdown.</b> When the run is scoped to one channel (`only`), the other channels
 * are not shown at all — a scoped question gets a scoped answer. That is a different operation from
 * grouping, and conflating them is how "네이버 문의" would come back with a Coupang column.
 */
export function channelBreakdown(
  coverage: readonly ChannelCoverageRow[],
  dataType: string,
  only?: string | null,
): ChannelBreakdownRow[] {
  return coverage
    .filter((r) => r.dataType === dataType)
    .filter((r) => !only || r.channelCode.toUpperCase() === only.toUpperCase())
    .map((r) => ({
      channelCode: r.channelCode,
      label: channelLabel(r),
      state: r.state,
      rows: r.rows,
      openRows: r.openRows,
      newestObservedAt: r.newestObservedAt,
      // A number may join a total only when the channel could actually have been counted. Adding an
      // unsupported channel's 0 to a cross-channel sum makes the sum read as complete when it is not.
      countable: hasObservations(r.state) || r.state === "ZERO",
    }));
}

/**
 * What a cross-channel total may honestly say.
 *
 * <b>A sum needs its own coverage sentence, not just its number.</b> "전체 문의 23건" over three
 * channels where one is unsupported and one is stale is a true addition and a misleading answer; the
 * qualifier is what makes it neither. `complete` is true only when every channel in the breakdown
 * could be counted AND is current — the same bar `ZERO` has to clear, applied to the whole.
 */
export interface CrossChannelTotal {
  readonly total: number;
  readonly openTotal: number | null;
  readonly complete: boolean;
  /** Channels whose numbers are NOT in the total, and the state that excluded each. */
  readonly excluded: readonly { channelCode: string; label: string; state: ChannelDataState }[];
  /** Channels counted whose freshness is unproven — in the total, but not proof of "지금". */
  readonly staleIncluded: readonly string[];
}

export function crossChannelTotal(rows: readonly ChannelBreakdownRow[]): CrossChannelTotal {
  const counted = rows.filter((r) => r.countable);
  const openValues = counted.map((r) => r.openRows).filter((v): v is number => v != null);
  return {
    total: counted.reduce((sum, r) => sum + r.rows, 0),
    openTotal: openValues.length > 0 ? openValues.reduce((a, b) => a + b, 0) : null,
    complete: rows.length > 0 && rows.every((r) => mayClaimCurrent(r.state)),
    excluded: rows.filter((r) => !r.countable)
      .map((r) => ({ channelCode: r.channelCode, label: r.label, state: r.state })),
    staleIncluded: counted.filter((r) => r.state === "OBSERVED_FRESHNESS_UNPROVEN")
      .map((r) => r.label),
  };
}

/**
 * The qualifier a cross-channel total must carry, or null when the total stands on its own.
 *
 * Named channels, named reasons — a seller who is told "일부 채널은 제외" cannot act, and a seller who
 * is told "쿠팡은 리뷰 API가 없어 제외" can.
 */
export function totalQualifier(total: CrossChannelTotal): string | null {
  if (total.complete) {
    return null;
  }
  const parts: string[] = [];
  if (total.excluded.length > 0) {
    const names = total.excluded.map((e) => `${e.label}(${reasonWord(e.state)})`).join(" · ");
    // The particle follows the closing bracket, so it agrees with the reason word rather than the
    // channel name — which is what a reader actually pronounces.
    parts.push(`${withTopic(names)} 이 합계에 없습니다`);
  }
  if (total.staleIncluded.length > 0) {
    parts.push(`${withTopic(total.staleIncluded.join(" · "))} 최신 여부를 확인하지 못했습니다`);
  }
  return parts.length > 0 ? parts.join(". ") + "." : null;
}

function reasonWord(state: ChannelDataState): string {
  switch (state) {
    case "NOT_SUPPORTED": return "채널 미제공";
    case "NOT_CONNECTED": return "미연결";
    case "BLOCKED": return "연결 끊김";
    default: return "확인 불가";
  }
}
