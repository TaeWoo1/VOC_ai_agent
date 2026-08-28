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
import type { RefreshFailure } from "./reviewRefresh";
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

export function freshnessVerdict(row: ChannelCoverageRow, window: DateWindow): FreshnessVerdict {
  if (row.state === "OBSERVED_FRESH") return "FRESH";
  if (row.state === "NOT_CONNECTED" || row.state === "BLOCKED") return "NOT_CONNECTED";
  // "Not supported" is the backend's word for "no automatic (API) path". NAVER (export upload) and
  // Coupang (Action Window) still have a seller-run path, so for a connected account the honest verdict
  // is "not collected for this window", with the human step offered — not "no path".
  if (row.state === "NOT_SUPPORTED" && !(row.connected && MANUAL_PATH_CHANNELS.has(row.channelCode))) {
    return "NOT_SUPPORTED";
  }
  const synced = dateOf(row.lastSuccessfulSyncAt);
  if (synced != null && synced >= window.from) return "FRESH";
  return row.state === "OBSERVED_FRESHNESS_UNPROVEN" ? "UNPROVEN" : "NOT_COLLECTED";
}

export const HUMAN_STEP_SENTENCE = "현재 리뷰는 최신 상태가 아닙니다. 새 리뷰를 확인하려면 판매자님의 한 번의 작업이 필요합니다.";

/**
 * The one sentence about the rows. Never 「0건」 under a freshness gate — the human-step sentence says
 * why there is nothing to count; and a measured zero for 「오늘」 is said as what it is: of the reviews
 * collected, none is from today.
 */
export function rowsSentence(
  previousCount: number | null, ratingWord: string, label: string, total: number, gated: boolean,
  token: PeriodToken | null,
): string {
  if (previousCount != null) return `방금 본 ${previousCount}건 중 ${ratingWord}리뷰는 ${total}건입니다.`;
  if (gated) {
    return total > 0
      ? `지금까지 수집된 ${label} ${ratingWord}리뷰는 ${total}건입니다.`
      : HUMAN_STEP_SENTENCE;
  }
  if (total === 0 && token === "TODAY") return `수집된 ${ratingWord}리뷰 중 오늘 것은 0건입니다.`;
  return `${label} 확인 가능한 ${ratingWord}리뷰가 ${total}건입니다.`;
}

/** Whether a "new" read must refuse to say 0 while some connected channel is not proven current. */
function isFreshnessSensitive(token: PeriodToken | null, rows: number): boolean {
  return token === "TODAY" || token === "YESTERDAY" || token === "THIS_WEEK" || rows === 0;
}

type Collected = NonNullable<SpecialistInput["collected"]>[number];

/** The freshness rows for one read, with this conversation's own completed collections counted. */
function freshnessOf(read: RecentReviewsRead, channel: string | null, window: DateWindow, collected: readonly Collected[]): FreshnessRow[] {
  const coverage = (read.coverage ?? []).filter((c) => c.dataType === "REVIEW"
    && (!channel || c.channelCode.toUpperCase() === channel.toUpperCase()));
  return coverage.map((c) => {
    // A collection the seller just ran at the conversation's request is a fact the backend's coverage
    // row cannot carry (a file upload is not a `dataType` sync there) — so it counts here.
    const seen = collected.find((k) => k.channelCode.toUpperCase() === c.channelCode.toUpperCase()
      && k.dataType === "REVIEW" && k.finishedAt.slice(0, 10) >= window.from);
    return {
      channelCode: c.channelCode, channelNameKo: c.channelNameKo, state: c.state,
      verdict: seen ? "FRESH" : freshnessVerdict(c, window),
      lastSuccessfulSyncAt: seen ? seen.finishedAt : c.lastSuccessfulSyncAt,
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
function overviewFromCoverage(row: ChannelCoverageRow): ChannelCapabilityOverview {
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
  const previous = filters.scope === "WORKING_SET" && input.workingSet?.kind === "REVIEWS" ? input.workingSet : null;
  const today = observationDate(input.referenceDate);
  // The previous set's window carries over a follow-up unless a new period was named; a fresh question
  // with no period defaults to the last seven days — a retrieval default, disclosed in the label.
  const token: PeriodToken | null = filters.period ?? previous?.filters.period?.token ?? "LAST_7_DAYS";
  const window = windowOf(token, today);
  const rating: "ALL" | "LOW" = filters.rating ?? previous?.filters.rating ?? "ALL";
  const channel = filters.channel ?? input.channelScope ?? previous?.filters.channelCode ?? null;
  const product = input.resolved.find((e) => e.kind === "PRODUCT")?.id
    ?? previous?.filters.productIds?.[0] ?? null;
  const readArgs = {
    from: window.from, to: window.to, negativeOnly: rating === "LOW",
    ...(channel ? { channel } : {}), ...(product ? { productId: product } : {}), size: ROWS_SIZE,
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
  let stale = staleOf(freshness);
  // A window the seller was already asked to collect is not asked for twice: while that step is pending,
  // the same question shows the rows held (the human-step card is still in the thread above).
  const alreadyAsked = input.pendingHumanWindow != null && input.pendingHumanWindow === token;
  const sensitive = previous == null && !alreadyAsked && isFreshnessSensitive(token, rowsOf(read).length);
  const accountOf = new Map(read.accounts.map((a) => [a.channelCode.toUpperCase(), a]));
  const requestedAt = new Date().toISOString();
  const refreshFailures: Array<{ channelNameKo: string; failure: RefreshFailure }> = [];
  let humanSteps = 0;
  let refreshed = 0;

  if (sensitive && stale.length > 0) {
    for (const f of stale) {
      const code = f.channelCode.toUpperCase();
      const account = accountOf.get(code) ?? null;
      const verdict = await capabilityFor(input, code, f, needId, refs, findings);
      if (verdict.acquisition === "AUTOMATIC" && input.refresher && account && !account.fileUpload) {
        input.progress?.("REFRESHING", `${f.channelNameKo ?? f.channelCode} 리뷰를 새로 가져오고 있습니다.`);
        const outcome = await input.refresher.refresh(account.accountId, "REVIEW");
        if (outcome.ok) {
          refreshed += 1;
          collected.push({ channelCode: code, dataType: "REVIEW", finishedAt: outcome.finishedAt, successRows: outcome.successRows });
        } else {
          refreshFailures.push({ channelNameKo: f.channelNameKo ?? f.channelCode, failure: outcome.failure });
        }
        continue;
      }
      if (verdict.acquisition === "GUIDED_HUMAN_ACTION" && verdict.guidedPath) {
        humanSteps += 1;
        artifacts.push(humanStep(f, verdict, account?.accountId ?? null, requestedAt, gapRef(input, f, needId, refs, findings)));
        continue;
      }
      // UNSUPPORTED (or AUTOMATIC with nothing to refresh through): said once, as a limit of the answer.
      gapRef(input, f, needId, refs, findings);
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
  const rows = rowsOf(read);
  const total = previousIds ? rows.length : read.total;
  const gated = humanSteps > 0;

  const listRef = evidence.add({
    kind: "REVIEW_LIST",
    sourceTool: OPERATOR_TOOL.LIST_RECENT_REVIEWS,
    args: { from: window.from, to: window.to, negativeOnly: rating === "LOW", channel: channel ?? null, product: product ?? null },
    locator: {
      label: "기간 내 리뷰", count: total,
      ...(channel ? { channelCode: channel } : {}), ...(product ? { productId: product } : {}),
    },
    events: eventRange(window.from, window.to),
    coverage: "COVERED",
    provenance: `reviews/recent:${token}${previous ? ":working-set" : ""}${refreshed > 0 ? ":refreshed" : ""}`,
  });
  refs.push(listRef);

  for (const failure of refreshFailures) {
    notes.push(`${failure.channelNameKo} 리뷰를 최신 상태로 갱신하지 못했습니다 (${REFRESH_FAILURE_LABEL[failure.failure]}). 지금까지 수집된 리뷰를 보여 드립니다.`);
  }
  if (gated) notes.push(HUMAN_STEP_SENTENCE);

  // ── The rows themselves, said as one sentence and one artifact.
  const label = periodLabel(token);
  findings.push({
    findingId: `f-${listRef.evidenceId}`,
    specialist: "REVIEW_OPS",
    statement: rowsSentence(previous?.count ?? null, ratingWord, label, total, gated || refreshFailures.length > 0, token),
    evidenceIds: [listRef.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: "/reviews",
    needId,
  });
  const list: ReviewListArtifact = {
    artifactId: `a-${listRef.evidenceId}`,
    type: "REVIEW_LIST",
    title: previous ? (ratingWord ? `방금 본 리뷰 중 ${ratingWord}리뷰` : "방금 본 리뷰") : `${label} 들어온 ${ratingWord}리뷰`,
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
    more: { label: "리뷰 화면에서 보기", to: "/reviews", count: total },
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
  artifacts.push(list);

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

  log("review_rows", { period: token, rating, channel: channel ?? "NONE", rows: rows.length, total,
    workingSet: previous != null, gated, stale: stale.length, refreshed, refreshFailed: refreshFailures.length,
    humanSteps, terminal: "OK" });
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
  input: SpecialistInput, f: FreshnessRow, needId: string, refs: EvidenceRef[], findings: Finding[],
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
  findings.push({
    findingId: `f-${ref.evidenceId}`,
    specialist: "REVIEW_OPS",
    statement: `${f.channelNameKo ?? f.channelCode} 리뷰는 ${f.verdict === "NOT_COLLECTED" ? "이 기간에 수집된 적이 없어" : "최신 수집이 확인되지 않아"} 새 리뷰를 말할 수 없습니다.`,
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
): HumanActionRequiredArtifact {
  const path = verdict.guidedPath!;
  return {
    artifactId: `a-${ref.evidenceId}`,
    type: "HUMAN_ACTION_REQUIRED",
    title: `${f.channelNameKo ?? f.channelCode} 새 리뷰를 확인하려면 판매자님의 확인이 필요합니다`,
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
  };
}
