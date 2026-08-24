/**
 * The one read that lets an answer name a channel — or refuse to.
 *
 * <b>A step, not a specialist.</b> Coverage is a property of the RUN, the same way grouping is: the
 * channels a seller can sell on do not change between InquiryOps and ReviewOps, and reading them twice
 * would buy the same facts twice and mint two evidence rows saying the same thing. So this is a shared
 * step both specialists call, and the {@link ChannelCoverageRead} it returns is cached per run.
 *
 * <b>What it mints is one evidence row PER CHANNEL, not one for the org.</b> That is the whole point of
 * the package: `locator.channelCode` is what makes a claim about NAVER checkable as a claim about
 * NAVER, and an org-wide row with a channel word in its sentence is exactly the unprovable claim the
 * scope gate has been refusing (`CHANNEL_UNPROVEN`) since it had nothing to accept instead.
 */
import type { EvidenceRef, Finding, SpecialistName } from "../state/OperatorState";
import type { ChannelCoverageRow } from "../../spring/types";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { SpecialistInput } from "./specialistInput";
import { attemptTool } from "../failure/SpecialistOutcome";
import type { ToolFailure } from "../failure/SpecialistOutcome";
import { eventRange } from "../scope/EvidenceTime";
import {
  channelBreakdown, coverageSentence, crossChannelTotal, hasObservations, mayReportAbsence,
  totalQualifier,
} from "../group/ChannelCoverage";
import type { ChannelBreakdownRow } from "../group/ChannelCoverage";

export interface ChannelCoverageRead {
  readonly rows: readonly ChannelCoverageRow[];
  readonly evidence: readonly EvidenceRef[];
  /** Evidence id per (channelCode, dataType) — how a later sentence cites the channel it names. */
  readonly evidenceByChannel: ReadonlyMap<string, string>;
  readonly failures: readonly ToolFailure[];
}

/** Cache slot a caller keeps for the run. One read per run, however many specialists want it. */
export interface ChannelCoverageCache { read: ChannelCoverageRead | null }

const EMPTY: ChannelCoverageRead = {
  rows: [], evidence: [], evidenceByChannel: new Map(), failures: [],
};

export function coverageKey(channelCode: string, dataType: string): string {
  return `${channelCode.toUpperCase()}:${dataType}`;
}

/**
 * Read coverage once and turn every row into evidence.
 *
 * <b>Every visible channel becomes a row, including the ones with nothing.</b> A channel dropped here
 * is a channel a later breakdown reports as absent, and absent reads as zero — the false calm one
 * layer up from the one this module exists to prevent.
 */
export async function readChannelCoverage(
  input: SpecialistInput,
  specialist: SpecialistName,
  cache: ChannelCoverageCache,
  needId?: string,
): Promise<ChannelCoverageRead> {
  if (cache.read) {
    return cache.read;
  }
  const { registry, budget, evidence, allowedTools } = input;
  if (!budget.spend("tool")) {
    return EMPTY;
  }
  const attempt = await attemptTool(
    { specialist, tool: OPERATOR_TOOL.GET_CHANNEL_COVERAGE, ...(needId ? { needId } : {}) },
    () => registry.invoke<ChannelCoverageRow[]>(OPERATOR_TOOL.GET_CHANNEL_COVERAGE, {}, allowedTools),
  );
  if (!attempt.ok) {
    return { ...EMPTY, failures: [attempt.failure] };
  }
  const rows = attempt.value ?? [];
  const refs: EvidenceRef[] = [];
  const byChannel = new Map<string, string>();
  for (const row of rows) {
    const ref = evidence.add({
      kind: "CHANNEL_COVERAGE",
      sourceTool: OPERATOR_TOOL.GET_CHANNEL_COVERAGE,
      args: { channel: row.channelCode, dataType: row.dataType },
      locator: {
        channelCode: row.channelCode,
        count: row.rows,
        // Closed vocabulary: the state IS the label, so a sentence can never carry a state word the
        // evidence does not carry.
        label: row.state,
      },
      // <b>Only the newest is known, so only the newest is claimed.</b> `from: null` is not a missing
      // value — it is the honest statement that this read knows when the LAST row happened and nothing
      // about when the first did. A range invented from the request would be the observation time
      // wearing a different name.
      events: hasObservations(row.state) ? eventRange(null, dateOf(row.newestObservedAt)) : null,
      coverage: "COVERED",
      provenance: `channel-coverage/${row.channelCode}:${row.dataType}:${row.state}`,
    });
    refs.push(ref);
    byChannel.set(coverageKey(row.channelCode, row.dataType), ref.evidenceId);
  }
  const read: ChannelCoverageRead = {
    rows, evidence: refs, evidenceByChannel: byChannel, failures: [],
  };
  cache.read = read;
  return read;
}

function dateOf(instant: string | null): string | null {
  return instant ? instant.slice(0, 10) : null;
}

/**
 * The findings a channel-grouped answer is made of: one row per channel, plus the qualified total.
 *
 * <b>A channel that cannot be counted still gets a sentence.</b> Dropping it would leave the seller
 * with a shorter list and no idea one was missing; naming it — "쿠팡은 리뷰 API가 없어 이 합계에
 * 없습니다" — is the difference between an answer and a shorter wrong answer.
 *
 * <b>The total is emitted only when it means something.</b> With one channel in scope there is nothing
 * to total, and printing the same number twice under two labels reads as two facts.
 */
export function channelFindings(
  read: ChannelCoverageRead,
  dataType: string,
  specialist: SpecialistName,
  needId: string,
  only?: string | null,
): { findings: Finding[]; rows: ChannelBreakdownRow[] } {
  const rows = channelBreakdown(read.rows, dataType, only);
  const findings: Finding[] = [];
  for (const row of rows) {
    const source = read.rows.find(
      (r) => r.channelCode === row.channelCode && r.dataType === dataType,
    );
    const evidenceId = read.evidenceByChannel.get(coverageKey(row.channelCode, dataType));
    if (!source || !evidenceId) {
      continue;
    }
    findings.push({
      findingId: `f-${evidenceId}`,
      specialist,
      statement: coverageSentence(source),
      evidenceIds: [evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: null,
      // <b>A gap sentence IS its own claim.</b> Without this flag the judge's core rule — evidence from
      // an uncertain source supports nothing — deletes exactly the sentences that exist to report the
      // uncertainty, and the seller is left with the false calm again.
      ...(mayReportAbsence(row.state) ? {} : { claimsCoverageLimit: true }),
      needId,
    });
  }

  if (rows.length > 1) {
    const total = crossChannelTotal(rows);
    const qualifier = totalQualifier(total);
    const cited = rows
      .map((r) => read.evidenceByChannel.get(coverageKey(r.channelCode, dataType)))
      .filter((id): id is string => id != null);
    if (cited.length > 0) {
      findings.push({
        findingId: `f-total-${dataType.toLowerCase()}`,
        specialist,
        statement: `연결된 채널 합계 ${total.total}건`
          + (total.openTotal != null ? ` (그중 확인이 필요한 것 ${total.openTotal}건)` : "")
          + (qualifier ? `. ${qualifier}` : "."),
        evidenceIds: cited,
        confidence: "NEEDS_REVIEW",
        verdict: null,
        surfaceLink: null,
        ...(total.complete ? {} : { claimsCoverageLimit: true }),
        needId,
      });
    }
  }
  return { findings, rows };
}
