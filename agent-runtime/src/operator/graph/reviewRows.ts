/**
 * ReviewOps' ROWS path — the reviews that arrived in a window, and whether "new" can be said at all.
 *
 * <b>Two facts travel together and the second gates the first.</b> `list_recent_reviews` returns the
 * rows a window holds AND, per channel, whether this seller's review collection is current. A row
 * count over a channel whose freshness is unproven is not a count of new reviews — it is a count of
 * what happened to be collected — so for a 「오늘 / 어제 / 이번 주」 read (or any read that found
 * nothing) an unproven channel never becomes 「0건」. That is §9 of the package, and
 * {@link freshnessVerdict} is the whole of it as a function.
 *
 * <b>Acquisition ≠ freshness — the decision table (channel-capability completion, 2026-08-28).</b>
 * Freshness says whether the stored rows are current enough for THIS question; the channel's
 * acquisition capability (`capability/ChannelCapability.ts`, read through
 * `get_channel_execution_capability`) says HOW they can be made current. Per stale channel:
 * <pre>
 *   FRESH                        ⇒ read, nothing else
 *   AUTOMATIC + stale            ⇒ REFRESHING stage; the conversation lane's Refresher runs the
 *                                   product's own collection ONCE; on success the rows are re-read
 *                                   with that run counted; on failure the stale rows are shown with
 *                                   「최신 상태로 갱신하지 못했습니다」 and the reason class — never a
 *                                   faked freshness, and no seller step (there is none to take)
 *   GUIDED_HUMAN_ACTION + stale  ⇒ HUMAN_ACTION_REQUIRED naming the guided path (NAVER
 *                                   EXPORT_ACTION_WINDOW with a FILE_UPLOAD fallback, Coupang
 *                                   WING_READ_ACTION_WINDOW) whether or not a local agent is paired —
 *                                   the frontend renders pairing inline; the artifact states the path
 *   UNSUPPORTED                  ⇒ stated once as a finding; no artifact
 * </pre>
 * The seller never learns which channel is API and which is a seller-center screen; the answer
 * either has the rows, is fetching them, or asks for exactly the step that channel needs.
 *
 * <b>A follow-up over the previous set re-reads the same window and INTERSECTS.</b> 「안 좋은 것만」
 * after 「오늘 새 리뷰」 is a filter over what the seller just saw; re-reading with the merged filters
 * and keeping only ids the previous turn showed is what makes 「방금 본 7건 중 2건」 a true sentence
 * about those seven, whatever else arrived since.
 *
 * <b>No review text enters state.</b> The preview rides on the live artifact for the screen and is
 * stripped before persistence (`persistableArtifact`); the evidence ref carries counts and dates.
 */
import type { EvidenceRef, Finding } from "../state/OperatorState";
import type { SpecialistInput } from "./specialistInput";
import type { ReviewOpsResult } from "./reviewOps";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { ChannelCapabilityRead, RecentReviewsRead } from "../tools/OperatorTools";
import { attemptTool } from "../failure/SpecialistOutcome";
import { eventRange, observationDate } from "../scope/EvidenceTime";
import type {
  Artifact, DateWindow, FreshnessRow, FreshnessVerdict, HumanActionRequiredArtifact, PeriodToken,
  ProductListArtifact, ReviewListArtifact,
} from "../../conversation/contract";
import { dateOf, periodLabel, windowOf } from "../../conversation/period";
import type { ChannelCapabilityOverview, ChannelCoverageRow } from "../../spring/types";
import { groupsBy } from "../group/ProductGrouping";
import { capabilityOf } from "../capability/ChannelCapability";
import type { ChannelCapabilitySources, ChannelCapabilityVerdict } from "../capability/ChannelCapability";
import { REFRESH_FAILURE_LABEL } from "./reviewRefresh";
import { asOfWord } from "../../conversation/asOf";
import type { RefreshFailure } from "./reviewRefresh";
import { isAcquisitionRequest } from "../../conversation/acquisitionRequest";
import { log } from "../../log";

const ROWS_SIZE = 50;

/**
 * What one coverage row lets an answer say about a window.
 *
 * `OBSERVED_FRESH` is fresh by the backend's own verdict. `OBSERVED_FRESHNESS_UNPROVEN` and `ZERO` are
 * refined by the window: a successful REVIEW collection on or after the window's first day means the
 * window was actually looked at, and the rows (or the zero) stand for it. Without one, the unproven
 * channel stays unproven and the zero is a channel that was not collected for this window.
 */
/** Channels whose review collection is a seller-run step rather than an API pull. */
const MANUAL_PATH_CHANNELS: ReadonlySet<string> = new Set(["NAVER", "COUPANG"]);

export function freshnessVerdict(row: ChannelCoverageRow, window: DateWindow | null): FreshnessVerdict {
  if (row.state === "OBSERVED_FRESH") return "FRESH";
  if (row.state === "NOT_CONNECTED" || row.state === "BLOCKED") return "NOT_CONNECTED";
  // "Not supported" is the backend's word for "no automatic (API) path". NAVER (export upload) and
  // Coupang (Action Window) still have a seller-run path, so for a connected account the honest verdict
  // is "not collected for this window", with the human step offered — not "no path".
  if (row.state === "NOT_SUPPORTED" && !(row.connected && MANUAL_PATH_CHANNELS.has(row.channelCode))) {
    return "NOT_SUPPORTED";
  }
  // With no window there is no "since when" to promote against: the question named no span, so the
  // backend's own state is the whole verdict (Conversation Contract Correctness v2).
  const synced = dateOf(row.lastSuccessfulSyncAt);
  if (window != null && synced != null && synced >= window.from) return "FRESH";
  return row.state === "OBSERVED_FRESHNESS_UNPROVEN" ? "UNPROVEN" : "NOT_COLLECTED";
}

/**
 * Kept as the closed vocabulary of the gate for older consumers; the answer no longer repeats it. What
 * the seller reads instead is one per-channel 「언제 기준」 sentence (`staleSentence`) said once.
 */
export const HUMAN_STEP_SENTENCE = "현재 리뷰는 최신 상태가 아닙니다. 새 리뷰를 확인하려면 판매자님의 한 번의 작업이 필요합니다.";
/** The gate sentence when nothing is asked of the seller but a channel is still unproven (a failed or partial refresh). */
export const UNPROVEN_SENTENCE = "아직 최신 상태가 확인되지 않은 채널이 있어 지금까지 수집된 리뷰만 보여 드립니다.";

/**
 * The one sentence about the rows — <b>the result first, the freshness as a bound on it, never as a
 * warning</b>.
 * <ul>
 *   <li>A follow-up over the previous set: 「방금 본 N건 중 …」.</li>
 *   <li>Stale (some connected channel's window is not proven current): the rows are said as
 *       「지금까지 확인한」 — what is held is held — and a zero is never 「0건」, it is 「확인한 범위에는
 *       없습니다」, because the unproven channel may hold what was not read.</li>
 *   <li>Fresh: the count as a fact; a fresh zero for 「오늘」 is said as none arrived.</li>
 * </ul>
 * Which channel is stale and since when is the artifact footer's job and `staleSentence`'s — not this one's.
 */
export function rowsSentence(
  previousCount: number | null, ratingWord: string, label: string, total: number, stale: boolean,
  token: PeriodToken | null,
): string {
  if (previousCount != null) return `방금 본 ${previousCount}건 중 ${ratingWord}리뷰는 ${total}건입니다.`;
  // The label is empty when no period was named; the sentence must then read as one about the reviews
  // themselves, not as one with a hole where a window would have been.
  const period = label ? `${label} ` : "";
  if (stale) {
    return total > 0
      ? `지금까지 확인한 ${period}${ratingWord}리뷰는 ${total}건입니다.`
      : `지금까지 확인한 범위에는 ${period}${ratingWord}리뷰가 없습니다.`;
  }
  if (total === 0 && token === "TODAY") return `오늘 들어온 ${ratingWord}리뷰는 없습니다.`;
  return `${period}확인 가능한 ${ratingWord}리뷰가 ${total}건입니다.`;
}

/**
 * 「네이버 리뷰는 오늘 09:12 이후 아직 확인하지 못했어요.」 — the per-channel fact behind a required step,
 * or 「…는 8월 20일 기준입니다.」 behind an offered one. Said ONCE, in the message; the artifact carries
 * the same instant as a compact footer status.
 */
export function staleSentence(channelName: string, asOf: string | null, required: boolean): string {
  if (required) {
    return asOf ? `${channelName} 리뷰는 ${asOf} 이후 아직 확인하지 못했어요.` : `${channelName} 리뷰는 아직 확인한 적이 없어요.`;
  }
  return asOf ? `${channelName} 리뷰는 ${asOf} 기준입니다.` : `${channelName} 리뷰는 아직 확인한 적이 없어요.`;
}

/**
 * Whether THIS question needs current rows: a 「오늘 / 어제 / 이번 주」 read is about what arrived, and a
 * channel not observed since the window opened cannot answer it. Every other window (a rating filter,
 * the last 7/30 days, a product) is answered from what is held, as of its last observation — a zero
 * there is still never 「0건」 under a stale channel (`rowsSentence`), and a refresh is offered.
 */
export function isFreshnessRequired(token: PeriodToken | null): boolean {
  return token === "TODAY" || token === "YESTERDAY" || token === "THIS_WEEK";
}

type Collected = NonNullable<SpecialistInput["collected"]>[number];

/** The span the returned rows themselves cover — used when no window was named, so nothing is claimed. */
function datesOf(rows: ReadonlyArray<{ writtenOn: string | null }>): ReturnType<typeof eventRange> | null {
  const days = rows.map((r) => r.writtenOn?.slice(0, 10)).filter((d): d is string => d != null).sort();
  return days.length > 0 ? eventRange(days[0]!, days.at(-1)!) : null;
}

/** The freshness rows for one read, with this conversation's own completed collections counted. */
function freshnessOf(read: RecentReviewsRead, channel: string | null, window: DateWindow | null, collected: readonly Collected[]): FreshnessRow[] {
  const coverage = (read.coverage ?? []).filter((c) => c.dataType === "REVIEW"
    && (!channel || c.channelCode.toUpperCase() === channel.toUpperCase()));
  return coverage.map((c) => {
    // A collection the seller just ran at the conversation's request is a fact the backend's coverage
    // row cannot carry (a file upload is not a `dataType` sync there) — so it counts here.
    const seen = collected.find((k) => k.channelCode.toUpperCase() === c.channelCode.toUpperCase()
      && k.dataType === "REVIEW" && (window == null || k.finishedAt.slice(0, 10) >= window.from));
    // A PARTIAL collection is not a proof of the window (Acceptance Closure §8): it is shown, said as
    // partial, and never promoted to FRESH.
    const proven = seen != null && !seen.partial;
    return {
      channelCode: c.channelCode, channelNameKo: c.channelNameKo, state: c.state,
      verdict: proven ? "FRESH" : freshnessVerdict(c, window),
      lastSuccessfulSyncAt: proven ? seen!.finishedAt : c.lastSuccessfulSyncAt,
      newestObservedAt: c.newestObservedAt,
    };
  });
}

/**
 * When the overview read is unavailable, the coverage row still says what the resolver needs: a
 * connector-served type (`supported`) refreshes itself; a connected channel without one reaches us by
 * the seller-run path the product ships for that channel. The same closed fact `freshnessVerdict`
 * already relies on, expressed in the overview's shape so one resolver serves both.
 */
export function overviewFromCoverage(row: ChannelCoverageRow): ChannelCapabilityOverview {
  const code = row.channelCode.toUpperCase();
  const guidedMethod = code === "NAVER" ? "EXPORT" : code === "COUPANG" ? "ACTION_WINDOW" : null;
  return {
    channelCode: code, channelNameKo: row.channelNameKo, connectorClass: null, autoCollectSupported: row.supported,
    // Mirror of `AcquisitionPathRegistry` + `ChannelApiGapRegistry` for the fallback only: NAVER and Coupang
    // have no review API, whatever a coverage row's `supported` says (that bit is the connector's declared
    // capability, not the platform's). The overview endpoint is the source of truth when it can be read.
    dataTypes: [{
      dataType: "REVIEW", label: null, supported: guidedMethod ? false : row.supported, verificationStatus: row.verificationStatus,
      acquisitionPaths: row.connected && guidedMethod
        ? [{ method: guidedMethod, verificationStatus: "NEEDS_VERIFICATION", recurrence: "SELLER_REPEATED" }] : [],
    }],
    unsupportedScopes: guidedMethod ? [{ code: "REVIEW_API", label: "리뷰 API 없음" }] : [],
  };
}

export async function readRecentReviews(input: SpecialistInput): Promise<ReviewOpsResult> {
  const { registry, budget, evidence, allowedTools } = input;
  const needId = input.needs[0]!.id;
  const pending = (reason: string): ReviewOpsResult => ({
    specialist: "REVIEW_OPS", findings: [], evidence: [], coverage: [],
    needStates: input.needs.map((n) => ({ id: n.id, status: "PENDING" as const, evidenceIds: [] })),
    note: reason,
  });
  if (!budget.spend("tool")) {
    return pending("리뷰 목록을 읽기 전에 예산이 끝났습니다.");
  }
  const filters = input.filters!;
  const anchorId = input.selectedObject?.kind === "REVIEW" ? input.selectedObject.id : null;
  const set = filters.scope === "WORKING_SET" && input.workingSet?.kind === "REVIEWS" ? input.workingSet : null;
  // <b>A set that is the anchor alone is not a filter to intersect with</b> (Agent Object v1). After a
  // click the working set holds one id — this review — so 「같은 상품의 비슷한 리뷰도 보여줘」 intersected
  // the product's rows down to the review the seller was already looking at and answered 「방금 본 1건
  // 중 1건」. Asking about the neighbours of an object is not a narrowing OF that object.
  const previous = set && anchorId && set.ids.length === 1 && set.ids[0] === anchorId ? null : set;
  const today = observationDate(input.referenceDate);
  // <b>An unnamed period is not a window</b> (Conversation Contract Correctness v2). This read used to
  // fall back to the last seven days when the sentence named no period: 「별점 낮은 리뷰 보여줘」 was
  // answered 「최근 7일 낮은 평점 리뷰는 3건」 while the seller held eight — a condition nobody stated,
  // narrowing an answer by more than half. The label disclosed the window, which makes the sentence
  // honest and the ANSWER still wrong: the seller asked about their low-rated reviews, not about a week.
  // So no period means no window; the read returns what is held, bounded by its page size and order.
  // The previous set's window still carries over a follow-up, because there the seller DID name it.
  const token: PeriodToken | null = filters.period ?? previous?.filters.period?.token ?? null;
  const periodDays = filters.period ? filters.periodDays : previous?.filters.period?.days ?? null;
  const window: DateWindow | null = token ? windowOf(token, today, periodDays) : null;
  const rating: "ALL" | "LOW" = filters.rating ?? previous?.filters.rating ?? "ALL";
  const channel = filters.channel ?? input.channelScope ?? previous?.filters.channelCode ?? null;
  // <b>An anchored review widens to ITS product, and the sentence says so</b> (Agent Object v1).
  // 「비슷한 리뷰도 있어?」 over a selected review is a question about that product's other reviews; the
  // honest answer names the widening rather than presenting the product's rows as 「이 리뷰」. Without
  // this the same sentence read the whole org, which is the same failure wearing a wider scope.
  const anchoredReview = input.selectedObject?.kind === "REVIEW" ? input.selectedObject : null;
  const product = input.resolved.find((e) => e.kind === "PRODUCT")?.id
    ?? previous?.filters.productIds?.[0] ?? anchoredReview?.productId ?? null;
  const widenedFromReview = anchoredReview != null && product != null && product === anchoredReview.productId
    && input.resolved.every((e) => e.kind !== "PRODUCT");
  // Query Accuracy v1: order goes to the backend (so OLDEST is the window's oldest, not the newest
  // page reversed); the limit is applied after the read so a follow-up can still intersect the set.
  const order: "NEWEST" | "OLDEST" = filters.order ?? "NEWEST";
  const limit = filters.limit ?? null;
  const readArgs = {
    ...(window ? { from: window.from, to: window.to } : {}), negativeOnly: rating === "LOW",
    ...(channel ? { channel } : {}), ...(product ? { productId: product } : {}), size: ROWS_SIZE, order,
  };
  const readRows = () => attemptTool(
    { specialist: "REVIEW_OPS", tool: OPERATOR_TOOL.LIST_RECENT_REVIEWS, needId },
    () => registry.invoke<RecentReviewsRead>(OPERATOR_TOOL.LIST_RECENT_REVIEWS, readArgs, allowedTools),
  );

  const attempt = await readRows();
  if (!attempt.ok) {
    return { ...pending("기간 내 리뷰를 읽지 못했습니다."), failures: [attempt.failure], terminal: "FAILED" };
  }
  let read = attempt.value;
  const previousIds = previous ? new Set(previous.ids) : null;
  const rowsOf = (r: RecentReviewsRead) => (previousIds ? r.items.filter((i) => previousIds.has(i.id)) : r.items);
  const collected: Collected[] = [...(input.collected ?? [])];
  let freshness = freshnessOf(read, channel, window, collected);

  const refs: EvidenceRef[] = [];
  const findings: Finding[] = [];
  const artifacts: Artifact[] = [];
  const notes: string[] = [];
  const ratingWord = rating === "LOW" ? "낮은 평점 " : "";

  // ── The freshness gate. Only when the read is about "now"; a 30-day window that found rows stands.
  // A follow-up over what was already shown filters rows the seller has; it asks for no collection
  // (R1). The freshness rows are still on the artifact — what changes is that nobody is sent away.
  const staleOf = (rows: readonly FreshnessRow[]) => rows.filter((f) => f.verdict === "UNPROVEN" || f.verdict === "NOT_COLLECTED");
  /**
   * <b>An instruction to collect is not a freshness question.</b> Freshness decides whether we must ASK;
   * it does not decide whether the seller may ask US. Once the guided export had run this morning the
   * channel read FRESH, and 「최신화해줘」 answered with the rows and no way to collect — the seller's own
   * instruction refused by our verdict about it. So an explicit request treats every readable channel as
   * one to act on, and everything downstream (capability, path, the seller's own confirmations) is
   * unchanged (`conversation/acquisitionRequest.ts`).
   */
  const acquisitionAsked = isAcquisitionRequest(input.goalText ?? "", { reviewsInContext: input.workingSet?.kind === "REVIEWS" });
  const actionableOf = (rows: readonly FreshnessRow[]) =>
    rows.filter((f) => f.verdict !== "NOT_CONNECTED" && f.verdict !== "NOT_SUPPORTED");
  let stale = acquisitionAsked ? actionableOf(freshness) : staleOf(freshness);
  // A window the seller was already asked to collect is not asked for twice: while that step is pending,
  // the same question shows the rows held (the human-step card is still in the thread above).
  // …but the WINDOW stays gated (Acceptance Closure §8-C): the same question does not get a second card,
  // and it does not get 「오늘 0건」 either — the channel is still unproven until the step lands.
  const alreadyAsked = input.pendingHumanWindow != null && input.pendingHumanWindow === token;
  const required = previous == null && (acquisitionAsked || isFreshnessRequired(token));
  const accountOf = new Map(read.accounts.map((a) => [a.channelCode.toUpperCase(), a]));
  const requestedAt = new Date().toISOString();
  const refreshFailures: Array<{ channelNameKo: string; asOf: string | null; failure: RefreshFailure }> = [];
  let humanSteps = 0;
  let offers = 0;
  let pendingSteps = 0;
  let refreshed = 0;
  const partialNames: string[] = [];
  const staleSentences: string[] = [];
  const asOfOf = (f: FreshnessRow) => asOfWord(f.lastSuccessfulSyncAt, today);

  // A follow-up over what was already shown filters rows the seller has; it asks for no collection (R1).
  if (previous == null && stale.length > 0) {
    for (const f of stale) {
      const code = f.channelCode.toUpperCase();
      const name = f.channelNameKo ?? f.channelCode;
      const account = accountOf.get(code) ?? null;
      const partialRun = collected.find((k) => k.channelCode.toUpperCase() === code && k.dataType === "REVIEW" && k.partial);
      if (partialRun) {
        // Collected this turn or on resume, but only partly: said as partial, not refreshed again, and not
        // a reason to send the seller away a second time.
        partialNames.push(name);
        pendingSteps += 1;
        continue;
      }
      const verdict = await capabilityFor(input, code, f, needId, refs, findings);
      if (verdict.acquisition === "AUTOMATIC" && input.refresher && account && !account.fileUpload) {
        // AUTOMATIC + stale ⇒ the agent refreshes itself, whether or not the question required it: the
        // seller connected this channel, and a connected channel is one the product may read.
        input.progress?.("REFRESHING", `${name} 리뷰를 새로 가져오고 있습니다.`);
        const outcome = await input.refresher.refresh(account.accountId, "REVIEW");
        if (outcome.ok) {
          refreshed += 1;
          collected.push({ channelCode: code, dataType: "REVIEW", finishedAt: outcome.finishedAt, successRows: outcome.successRows, partial: outcome.partial });
          if (outcome.partial) partialNames.push(name);
        } else {
          refreshFailures.push({ channelNameKo: name, asOf: asOfOf(f), failure: outcome.failure });
        }
        continue;
      }
      if (verdict.acquisition === "GUIDED_HUMAN_ACTION" && verdict.guidedPath) {
        // <b>One channel's collection state is said ONCE, by whichever thing carries the control</b>
        // (Agent Object + First-use Closure v1 §3). A step card already names the channel, the as-of
        // instant and the move; the prose sentence beside it was the same fact in weaker words, and the
        // seller had to notice the two were about the same channel. The card wins — it is the only one
        // of the two that can be acted on. Channels with NO card still say their sentence below.
        if (!required) {
          // The rows answer the question as of their last observation; the step is offered, compactly.
          offers += 1;
          const sentence = staleSentence(name, asOfOf(f), false);
          artifacts.push(humanStep(f, verdict, account?.accountId ?? null, requestedAt, gapRef(input, f, needId, refs, findings, false, sentence), true));
          continue;
        }
        if (alreadyAsked) {
          // The card is already in the thread above; the window stays gated without a second card.
          pendingSteps += 1;
          staleSentences.push(staleSentence(name, asOfOf(f), true));
          continue;
        }
        humanSteps += 1;
        const sentence = staleSentence(name, asOfOf(f), true);
        // The card carries this channel's state AND the step; the gap is still evidence (the answer's
        // coverage limit is real), but it is not also printed as prose above its own card.
        artifacts.push(humanStep(f, verdict, account?.accountId ?? null, requestedAt, gapRef(input, f, needId, refs, findings, false, sentence), false));
        continue;
      }
      // UNSUPPORTED (or AUTOMATIC with nothing to refresh through): said once, as a limit of the answer.
      const sentence = staleSentence(name, asOfOf(f), required);
      gapRef(input, f, needId, refs, findings, required, sentence);
      staleSentences.push(sentence);
    }
    if (refreshed > 0) {
      // The re-read: the same window, with this turn's own collections counted. One attempt, charged.
      if (budget.spend("tool")) {
        const again = await readRows();
        if (again.ok) read = again.value;
      }
      freshness = freshnessOf(read, channel, window, collected);
      stale = staleOf(freshness);
    }
  }
  const matched = rowsOf(read);
  const total = previousIds ? matched.length : read.total;
  // Query Accuracy v1: the limit is applied after the set intersection, so 「그중 최근 1개」 stands on the set.
  const rows = limit != null ? matched.slice(0, limit) : matched;
  // Gated = a required read over a channel whose window is still unproven — asked now, asked earlier,
  // only partly collected, or a refresh that failed. An offered step gates nothing.
  const gated = required && (humanSteps > 0 || pendingSteps > 0 || refreshFailures.length > 0);
  const anyStale = previous == null && stale.length > 0;

  const listRef = evidence.add({
    kind: "REVIEW_LIST",
    sourceTool: OPERATOR_TOOL.LIST_RECENT_REVIEWS,
    args: { from: window?.from ?? null, to: window?.to ?? null, negativeOnly: rating === "LOW", channel: channel ?? null, product: product ?? null },
    locator: {
      label: "기간 내 리뷰", count: total,
      ...(channel ? { channelCode: channel } : {}), ...(product ? { productId: product } : {}),
    },
    // No window ⇒ the rows date themselves: the evidence's span is what came back, never a claimed one.
    events: window
      ? eventRange(window.from, window.to)
      : datesOf(rows),
    coverage: "COVERED",
    provenance: `reviews/recent:${token ?? "NONE"}${previous ? ":working-set" : ""}${refreshed > 0 ? ":refreshed" : ""}`,
  });
  refs.push(listRef);

  for (const failure of refreshFailures) {
    notes.push(`${failure.channelNameKo} 리뷰를 최신 상태로 갱신하지 못했습니다 (${REFRESH_FAILURE_LABEL[failure.failure]}). `
      + (failure.asOf ? `${failure.asOf} 기준으로 보여 드립니다.` : "지금까지 확인한 리뷰를 보여 드립니다."));
  }
  for (const name of partialNames) {
    notes.push(`${name} 리뷰는 일부만 가져왔습니다. 지금 보이는 것이 전부가 아닐 수 있습니다.`);
  }
  // One 「언제 기준」 sentence per stale channel — never the same warning twice, never a channel that is fine.
  notes.push(...staleSentences);
  // Agent Object v1: the widening is NAMED. These rows are the anchored review's product's, not that
  // review's — an answer that showed them without saying so would be the demonstrative quietly growing.
  if (widenedFromReview) notes.push("방금 보신 리뷰와 같은 상품의 리뷰입니다.");

  // ── The rows themselves, said as one sentence and one artifact.
  // A label only when a period was named: 「최근」 on a read with no window would be a period claim the
  // sentence never made and the query never applied.
  const label = token ? periodLabel(token, window?.days) : "";
  findings.push({
    findingId: `f-${listRef.evidenceId}`,
    specialist: "REVIEW_OPS",
    statement: rowsSentence(previous?.count ?? null, ratingWord, label, total, anyStale, token)
      + (limit != null && rows.length < total ? ` 그중 ${order === "OLDEST" ? "가장 오래된" : "가장 최근"} ${rows.length}건입니다.` : ""),
    evidenceIds: [listRef.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: "/reviews",
    needId,
  });
  const scopeName = channel
    ? freshness.find((f) => f.channelCode.toUpperCase() === channel.toUpperCase())?.channelNameKo ?? null
    : null;
  const list: ReviewListArtifact = {
    artifactId: `a-${listRef.evidenceId}`,
    type: "REVIEW_LIST",
    // <b>A scoped read names its scope on the object, not in prose.</b> When the rows are one channel's —
    // whether the sentence said so or the thread's focus did — the card says whose they are, so a narrowing
    // the seller did not restate this turn is still visible where the rows are (Chat-first Continuity §5).
    title: (previous ? (ratingWord ? `방금 본 리뷰 중 ${ratingWord}리뷰` : "방금 본 리뷰")
      : widenedFromReview ? `같은 상품의 ${ratingWord}리뷰`
        : `${scopeName ? `${scopeName} ` : ""}${label ? `${label} 들어온 ` : ""}${ratingWord}리뷰`)
      + (limit != null ? ` · ${order === "OLDEST" ? "가장 오래된" : "가장 최근"} ${Math.min(limit, rows.length)}건` : ""),
    scope: { channelCode: channel, period: window, rating, productId: product },
    totalCount: total,
    items: rows.map((r) => ({
      reviewId: r.id, accountId: r.sellerAccountId, channelCode: r.channelCode, channelNameKo: r.channelNameKo,
      writtenOn: r.writtenOn, rating: r.rating, negative: r.negative, preview: r.preview,
      productId: r.productId, productName: r.productName,
      // Backend-decided; an older backend leaves it absent, and absent is NONE — a label is not a binding.
      executableIdentity: r.executableIdentity ?? "NONE",
      to: `/reviews`,
    })),
    freshness,
    freshnessRequired: required,
    referenceDate: today,
    more: { label: "리뷰 화면에서 보기", to: "/reviews", count: total },
    // No freshness prose on the card: the footer shows 「채널 · 언제 기준」 and the message says it once.
  };
  // The rows come first; an offered refresh sits under them.
  artifacts.unshift(list);

  // ── 「상품별로 묶어줘」: the same rows, grouped in-process by the product each row already carries.
  if (previous && groupsBy(input.grouping, "PRODUCT")) {
    const byProduct = new Map<string, { name: string; count: number }>();
    let unattributed = 0;
    for (const r of rows) {
      if (!r.productId) { unattributed += 1; continue; }
      const acc = byProduct.get(r.productId) ?? { name: r.productName ?? "(이름 없는 상품)", count: 0 };
      acc.count += 1;
      byProduct.set(r.productId, acc);
    }
    const grouped: ProductListArtifact = {
      artifactId: `a-${listRef.evidenceId}-products`,
      type: "PRODUCT_LIST",
      title: "상품별로 묶은 리뷰",
      items: [...byProduct.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([productId, acc]) => ({
          productId, productName: acc.name, facts: [{ label: "리뷰", count: acc.count }], to: `/products/${productId}`,
        })),
      ...(unattributed > 0 ? { note: `상품이 연결되지 않은 리뷰 ${unattributed}건은 묶지 못했습니다.` } : {}),
    };
    artifacts.push(grouped);
    findings.push({
      findingId: `f-${listRef.evidenceId}-grouped`,
      specialist: "REVIEW_OPS",
      statement: `방금 본 ${previous.count}건을 상품 ${byProduct.size}개로 묶었습니다`
        + (unattributed > 0 ? ` (상품이 연결되지 않은 ${unattributed}건 제외)` : "") + ".",
      evidenceIds: [listRef.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: "/products",
      needId,
    });
  }

  log("review_rows", { period: token ?? "NONE", rating, channel: channel ?? "NONE", rows: rows.length, total, order, limit: limit ?? "NONE",
    workingSet: previous != null, required, gated, stale: stale.length, refreshed, refreshFailed: refreshFailures.length,
    humanSteps, offers, terminal: "OK" });
  return {
    specialist: "REVIEW_OPS",
    findings,
    evidence: refs,
    coverage: [],
    failures: [],
    terminal: "OK",
    artifacts,
    needStates: input.needs.map((n) => ({
      id: n.id, status: "SATISFIED" as const, evidenceIds: refs.map((r) => r.evidenceId),
      coverage: "COVERED" as const, complete: !gated && refreshFailures.length === 0 && read.items.length >= read.total,
      settledBy: "REVIEW_OPS" as const,
    })),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/** The evidence ref + finding for one channel that cannot say "new" — the GAP the answer discloses. */
function gapRef(
  input: SpecialistInput, f: FreshnessRow, needId: string, refs: EvidenceRef[], findings: Finding[], required: boolean,
  sentence: string,
): EvidenceRef {
  const ref = input.evidence.add({
    kind: "HUMAN_ACTION",
    sourceTool: OPERATOR_TOOL.LIST_RECENT_REVIEWS,
    args: { channel: f.channelCode, verdict: f.verdict },
    locator: { channelCode: f.channelCode, label: f.verdict, count: 0 },
    events: null,
    coverage: "COVERED",
    provenance: `reviews/recent:freshness:${f.verdict}`,
  });
  refs.push(ref);
  // A coverage-limit finding only when the question required current rows; an offered refresh is not a gap.
  // Its statement IS the per-channel sentence the note carries, so the prose says it once (deduped by text).
  if (required) findings.push({
    findingId: `f-${ref.evidenceId}`,
    specialist: "REVIEW_OPS",
    statement: sentence,
    evidenceIds: [ref.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: null,
    claimsCoverageLimit: true,
    needId,
  });
  return ref;
}

/**
 * The channel's acquisition capability, through the registry (charged, under the plan's authorization).
 * A failed or unauthorized read falls back to what the coverage row itself says (`overviewFromCoverage`).
 */
async function capabilityFor(
  input: SpecialistInput, code: string, f: FreshnessRow, needId: string, refs: EvidenceRef[], findings: Finding[],
): Promise<ChannelCapabilityVerdict> {
  void findings;
  let sources: ChannelCapabilitySources | null = null;
  if (input.budget.spend("tool")) {
    const attempt = await attemptTool(
      { specialist: "REVIEW_OPS", tool: OPERATOR_TOOL.GET_CHANNEL_EXECUTION_CAPABILITY, needId },
      () => input.registry.invoke<ChannelCapabilityRead>(
        OPERATOR_TOOL.GET_CHANNEL_EXECUTION_CAPABILITY, { channel: code }, input.allowedTools,
      ),
    );
    if (attempt.ok && attempt.value.overview) {
      sources = {
        overview: attempt.value.overview, transports: attempt.value.transports, publish: attempt.value.publish,
        reviewChannel: attempt.value.reviewChannel, localAgent: input.localAgent ?? "UNKNOWN",
      };
    }
  }
  if (!sources) {
    const row: ChannelCoverageRow = {
      channelCode: code, channelNameKo: f.channelNameKo, dataType: "REVIEW", state: f.state,
      supported: !(f.state === "NOT_SUPPORTED"), verificationStatus: null,
      connected: f.state !== "NOT_CONNECTED" && f.state !== "BLOCKED", connectionStatus: null,
      routineEnabled: false, routinePausedBy: null, lastSuccessfulSyncAt: f.lastSuccessfulSyncAt,
      rows: 0, openRows: null, newestObservedAt: f.newestObservedAt,
    };
    sources = { overview: overviewFromCoverage(row), transports: null, publish: null, reviewChannel: null, localAgent: input.localAgent ?? "UNKNOWN" };
  }
  const verdict = capabilityOf({ channelCode: code, dataType: "REVIEW", objectKind: "REVIEW" }, sources);
  refs.push(input.evidence.add({
    kind: "CHANNEL_COVERAGE",
    sourceTool: OPERATOR_TOOL.GET_CHANNEL_EXECUTION_CAPABILITY,
    args: { channel: code, dataType: "REVIEW" },
    locator: { channelCode: code, label: verdict.acquisition },
    events: null,
    coverage: "COVERED",
    provenance: `capability:${verdict.acquisitionEvidence.source}:${verdict.acquisitionEvidence.verification}`,
  }));
  return verdict;
}

function humanStep(
  f: FreshnessRow, verdict: ChannelCapabilityVerdict, accountId: string | null, requestedAt: string, ref: EvidenceRef,
  optional: boolean,
): HumanActionRequiredArtifact {
  return reviewImportStep(f, verdict, accountId, requestedAt, `a-${ref.evidenceId}`, optional);
}

/**
 * **The review-import step card — ONE producer.**
 *
 * Two lanes ask a seller for the same step (this path, and the deterministic freshness/acquisition lanes
 * beside it), and for a while they built the card independently: two titles for one action, and fields
 * that could drift apart without anything noticing. Everything that decides what the card SAYS is here,
 * and the callers supply only what is genuinely theirs — the artifact id, and whether the answer waits on
 * it (Chat-first Semantic & Surface Finalization v1 §1).
 */
export function reviewImportStep(
  f: FreshnessRow, verdict: ChannelCapabilityVerdict, accountId: string | null, requestedAt: string,
  artifactId: string, optional: boolean,
): HumanActionRequiredArtifact {
  const path = verdict.guidedPath!;
  const name = f.channelNameKo ?? f.channelCode;
  return {
    artifactId,
    type: "HUMAN_ACTION_REQUIRED",
    title: optional ? `${name} 리뷰 최신 상태로 갱신` : `${name} 최신 리뷰 가져오기`,
    actionType: "REVIEW_IMPORT",
    reason: f.verdict === "NOT_COLLECTED" ? "NOT_COLLECTED" : "FRESHNESS_UNPROVEN",
    path,
    channelCode: f.channelCode,
    channelNameKo: f.channelNameKo,
    accountId,
    dataType: "REVIEW",
    to: path === "FILE_UPLOAD" ? "/connect/upload" : accountId ? `/connect/channels/${accountId}` : null,
    requestedAt,
    resumable: true,
    requiresLocalAgent: verdict.requiresLocalAgent,
    ...(verdict.fallback ? { fallback: verdict.fallback } : {}),
    asOf: f.lastSuccessfulSyncAt,
    ...(optional ? { optional: true } : {}),
  };
}
