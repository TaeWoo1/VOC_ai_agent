/**
 * <b>「네이버 리뷰 최신화해줘」 — the instruction, executed.</b>
 *
 * <b>Why this lane exists at all.</b> An acquisition instruction is a bad sentence to plan and a trivial
 * one to act on. Live on 2026-09-02, 「그럼 최신화해줘」 said under a list of NAVER reviews was planned three
 * different ways across two attempts — a working-set refine that re-printed the same two rows, and a
 * checklist turn that answered 「지금 먼저 하실 일은 없습니다」 — because the sentence names no object for a
 * planner to route on. Meanwhile the product already knows exactly what it means: this channel, this
 * seller's account, the guided review acquisition it has always had.
 *
 * <b>This is not a goal planner.</b> It is the same family as CLICK==FOCUS and the anchored PREPARE
 * (Agent Interaction Model v2): a closed instruction about an object the conversation is already holding,
 * carried out through the machinery that owns it. It chooses no tools, invents no evidence, and reads one
 * thing — the channel's own coverage — to name the account and the path. A sentence it does not recognise,
 * a channel it cannot resolve, or a channel whose acquisition is automatic all fall through to the planner
 * exactly as before.
 *
 * <b>It widens nothing.</b> The artifact it returns is the artifact the freshness gate has always
 * produced; the run behind it is the same guided READ, performed in the seller's own window with the
 * marketplace's own confirmations. No write path, composer or submission reads this file.
 */
import type { SpringClientBundle } from "../http/AgentRunService";
import type { ChannelCoverageRow, ChannelSummary, SellerAccountSummary } from "../spring/types";
import type { Artifact, HumanActionRequiredArtifact } from "./contract";
import { capabilityOf } from "../operator/capability/ChannelCapability";
import { overviewFromCoverage } from "../operator/graph/reviewRows";
import { asOfWord } from "./asOf";
import { log } from "../log";

export interface AcquisitionStep {
  readonly artifact: HumanActionRequiredArtifact;
  readonly message: string;
}

/**
 * The step for one channel's review acquisition, or null when this instruction is not one this lane owns.
 *
 * Null is returned — and the planner keeps the turn — when the channel has no coverage row, when nothing
 * on it is connected, or when its acquisition is AUTOMATIC (there the product refreshes itself through the
 * rows path's own refresher, and asking the seller for a step would be asking for nothing).
 */
export async function acquisitionStepFor(
  bundle: SpringClientBundle, channelCode: string, localAgent: "PAIRED" | "ABSENT" | "UNKNOWN", now: string,
): Promise<AcquisitionStep | null> {
  const code = channelCode.toUpperCase();
  let coverage: ChannelCoverageRow | null = null;
  let accountId: string | null = null;
  try {
    const rows = (await bundle.operator.getChannelCoverage?.()) ?? [];
    coverage = rows.find((r: ChannelCoverageRow) => r.dataType === "REVIEW" && r.channelCode.toUpperCase() === code) ?? null;
    if (!coverage || !coverage.connected) return null;
    const [channels, accounts] = await Promise.all([bundle.operator.listChannels(), bundle.inquiry.listSellerAccounts()]);
    const channelId = channels.find((c: ChannelSummary) => c.code.toUpperCase() === code)?.id ?? null;
    accountId = channelId ? accounts.find((a: SellerAccountSummary) => a.channelId === channelId && !a.fileUpload)?.id ?? null : null;
  } catch {
    return null;
  }
  if (!accountId) return null;

  let overview = null;
  try {
    overview = (await bundle.operator.getChannelCapabilityOverview?.(code)) ?? null;
  } catch {
    overview = null;
  }
  const verdict = capabilityOf(
    { channelCode: code, dataType: "REVIEW", objectKind: "REVIEW" },
    { overview: overview ?? overviewFromCoverage(coverage), transports: null, publish: null, reviewChannel: null, localAgent },
  );
  // AUTOMATIC is the product's own job and needs no seller step; UNSUPPORTED has no step to offer.
  if (verdict.acquisition !== "GUIDED_HUMAN_ACTION" || !verdict.guidedPath) return null;

  const name = coverage.channelNameKo ?? coverage.channelCode;
  const path = verdict.guidedPath;
  const artifact: HumanActionRequiredArtifact = {
    artifactId: `a-acquire-${code.toLowerCase()}`,
    type: "HUMAN_ACTION_REQUIRED",
    title: `${name} 리뷰 최신 상태 확인`,
    actionType: "REVIEW_IMPORT",
    reason: coverage.lastSuccessfulSyncAt ? "FRESHNESS_UNPROVEN" : "NOT_COLLECTED",
    path,
    channelCode: coverage.channelCode,
    channelNameKo: coverage.channelNameKo,
    accountId,
    dataType: "REVIEW",
    to: path === "FILE_UPLOAD" ? "/connect/upload" : `/connect/channels/${accountId}`,
    requestedAt: now,
    resumable: true,
    requiresLocalAgent: verdict.requiresLocalAgent,
    ...(verdict.fallback ? { fallback: verdict.fallback } : {}),
    asOf: coverage.lastSuccessfulSyncAt,
    // The seller already gave the instruction; the card does not ask for it a second time.
    autoStart: true,
  };
  // What is honest to say before the run: what we are about to do, and when this channel was last read.
  // Never a promise about what will come back — that sentence belongs to the run's own result (§3).
  const word = asOfWord(coverage.lastSuccessfulSyncAt, now.slice(0, 10));
  const message = word
    ? `${name} 리뷰를 지금 확인하겠습니다. 마지막으로 확인한 것은 ${word}입니다.`
    : `${name} 리뷰를 지금 확인하겠습니다.`;
  log("conversation_acquisition_lane", { channel: code, path, asOf: word != null });
  return { artifact, message };
}

/** The artifacts a settled acquisition turn carries — the card, and nothing else it did not read. */
export function acquisitionArtifacts(step: AcquisitionStep): Artifact[] {
  return [step.artifact];
}
