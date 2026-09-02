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
import { overviewFromCoverage, reviewImportStep } from "../operator/graph/reviewRows";
import { asOfWord } from "./asOf";
import { log } from "../log";

/**
 * What this channel's review acquisition needs, decided by CAPABILITY rather than by the sentence.
 *
 * The same seller intent — "make this current" — is a different action per channel, and the difference is
 * not the seller's to know: an AUTOMATIC channel is the product's own collection, a GUIDED one is one step
 * in the seller's own window. Both are READs.
 */
export type AcquisitionPlan =
  | {
      /**
       * The card as the shared producer builds it — plain, and NOT auto-starting. Whether the seller
       * already gave the instruction is the CALLER's fact: the acquisition lane sets `autoStart`, and the
       * freshness question lane, which is answering a question rather than carrying out an order, does not.
       */
      readonly kind: "GUIDED";
      readonly artifact: HumanActionRequiredArtifact;
      readonly message: string;
      readonly accountId: string;
      readonly channelName: string;
    }
  | {
      readonly kind: "AUTOMATIC";
      readonly accountId: string;
      readonly channelName: string;
    };

/** Back-compat alias for the guided shape the acquisition lane renders. */
export interface AcquisitionStep {
  readonly artifact: HumanActionRequiredArtifact;
  readonly message: string;
  /** True when the product can make this channel current by itself — no seller step exists to ask for. */
  readonly refreshable: boolean;
  readonly accountId: string;
}

/**
 * The step for one channel's review acquisition, or null when this instruction is not one this lane owns.
 *
 * Null is returned — and the planner keeps the turn — when the channel has no coverage row, when nothing
 * on it is connected, or when its acquisition is AUTOMATIC (there the product refreshes itself through the
 * rows path's own refresher, and asking the seller for a step would be asking for nothing).
 */
export async function acquisitionPlanFor(
  bundle: SpringClientBundle, channelCode: string, localAgent: "PAIRED" | "ABSENT" | "UNKNOWN", now: string,
  /**
   * The coverage row the CALLER already read, when it has one.
   *
   * One turn, one source for one fact: a caller that has just read this channel's coverage for its own
   * answer must not have the card built from a second, independently-timed read — that is how the same
   * step showed 「8월 27일 기준」 on the card and 「8월 20일 기준」 in the sentence beside it.
   */
  known?: ChannelCoverageRow | null,
): Promise<AcquisitionPlan | null> {
  const code = channelCode.toUpperCase();
  let coverage: ChannelCoverageRow | null = null;
  let account: SellerAccountSummary | null = null;
  let accountId: string | null = null;
  try {
    const rows = known ? [known] : (await bundle.operator.getChannelCoverage?.()) ?? [];
    coverage = rows.find((r: ChannelCoverageRow) => r.dataType === "REVIEW" && r.channelCode.toUpperCase() === code) ?? null;
    if (!coverage || !coverage.connected) return null;
    const [channels, accounts] = await Promise.all([bundle.operator.listChannels(), bundle.inquiry.listSellerAccounts()]);
    const channelId = channels.find((c: ChannelSummary) => c.code.toUpperCase() === code)?.id ?? null;
    // **A file-upload account is exactly what a GUIDED export writes through**, so it is not excluded
    // here — it is excluded only where it genuinely cannot serve (the AUTOMATIC refresh below). A
    // non-upload account is preferred when the channel has both.
    const onChannel = channelId ? accounts.filter((a: SellerAccountSummary) => a.channelId === channelId) : [];
    account = onChannel.find((a: SellerAccountSummary) => !a.fileUpload) ?? onChannel[0] ?? null;
    accountId = account?.id ?? null;
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
  const name = coverage.channelNameKo ?? coverage.channelCode;
  // AUTOMATIC is the product's own job and has no seller step to ask for; UNSUPPORTED has neither.
  // An upload-only account has no API collection to run, whatever the registry says about the channel.
  if (verdict.acquisition === "AUTOMATIC") {
    return account?.fileUpload ? null : { kind: "AUTOMATIC", accountId, channelName: name };
  }
  if (verdict.acquisition !== "GUIDED_HUMAN_ACTION" || !verdict.guidedPath) return null;

  // **The card is built by ONE producer**, shared with the rows path — two lanes asking for the same step
  // must not name it two different things (`reviewRows.reviewImportStep`).
  const artifact = reviewImportStep(
    {
      channelCode: coverage.channelCode, channelNameKo: coverage.channelNameKo, state: coverage.state,
      verdict: coverage.lastSuccessfulSyncAt ? "UNPROVEN" : "NOT_COLLECTED",
      lastSuccessfulSyncAt: coverage.lastSuccessfulSyncAt, newestObservedAt: coverage.newestObservedAt,
    },
    verdict, accountId, now, `a-acquire-${code.toLowerCase()}`, false,
  );
  // What is honest to say before the run: what we are about to do, and when this channel was last read.
  // Never a promise about what will come back — that sentence belongs to the run's own result (§3).
  const word = asOfWord(coverage.lastSuccessfulSyncAt, now.slice(0, 10));
  const message = word
    ? `${name} 리뷰를 지금 확인하겠습니다. 마지막으로 확인한 것은 ${word}입니다.`
    : `${name} 리뷰를 지금 확인하겠습니다.`;
  log("conversation_acquisition_lane", { channel: code, path: artifact.path, asOf: word != null });
  return { kind: "GUIDED", artifact, message, accountId, channelName: name };
}

/**
 * The guided step alone — what a caller that can only render a card wants. An AUTOMATIC channel answers
 * with `refreshable`, so the caller can run the product's own collection instead of asking for nothing.
 */
export async function acquisitionStepFor(
  bundle: SpringClientBundle, channelCode: string, localAgent: "PAIRED" | "ABSENT" | "UNKNOWN", now: string,
  known?: ChannelCoverageRow | null,
): Promise<AcquisitionStep | null> {
  const plan = await acquisitionPlanFor(bundle, channelCode, localAgent, now, known);
  if (!plan) return null;
  if (plan.kind === "AUTOMATIC") {
    return { artifact: null as never, message: "", refreshable: true, accountId: plan.accountId };
  }
  return { artifact: plan.artifact, message: plan.message, refreshable: false, accountId: plan.accountId };
}

/** The artifacts a settled acquisition turn carries — the card, and nothing else it did not read. */
export function acquisitionArtifacts(step: { readonly artifact: HumanActionRequiredArtifact }): Artifact[] {
  return [step.artifact];
}
