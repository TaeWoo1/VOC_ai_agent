import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Section, ListBox } from "../../components/ui/Section";
import { Facts } from "../../components/ui/ObjectRow";
import { Empty } from "../../components/ui/Empty";
import { Chip } from "../../components/ui/Chip";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { AiMarkChip, TriageTierChip } from "../../components/reviews/TriageTierChip";
import { ReviewReadDetail } from "../../components/reviews/ReviewReadDetail";
import { SegmentBtn, SellerCorrectionChip, formatDateTime, josa, parseTierParam } from "../../components/reviews/recordParts";
import { MasterDetail, useWideLayout } from "../../components/workspace/MasterDetail";
import { CaseLayout } from "../../components/workspace/CaseLayout";
import { OperationsCaseView } from "./OperationsCase";
import { api } from "../../lib/apiClient";
import { ratingLabel } from "../../lib/reviewRecord";
import { plainText, previewText } from "../../lib/plainText";
import { channelShort, COPY } from "../../lib/copy/customerOps";
import { TRIAGE_TAG_DISCLOSURE, TRIAGE_TIERS, TRIAGE_TIER_LABEL } from "../../lib/reviewTriage";
import { Disclosure } from "../../components/ui/Disclosure";
import { useReviewLocate } from "../../lib/actionWindow/locate/useReviewLocate";
import type { ReviewAccount } from "../../lib/reviewAccounts";
import type {
  ChannelReviewDetailView,
  ReviewRecordChannelFacts,
  ReviewRecordPageView,
  ReviewTriageTier,
  TriageBehaviorEvent,
} from "../../lib/types";

const PAGE_SIZE = 20;
const WORD = "리뷰";

type Sort = "attention" | "newest" | "lowest";

/**
 * <b>리뷰 — the organisation's record</b> (UI/UX v2 Phases 2–3).
 *
 * <p><b>A place to look things up, not a place to work.</b> The work — every review that waits on the seller, and
 * the seller's own reply work before approval — is 확인할 일's; what they approved and have not posted is 실행
 * 대기's. The 「내 답변 작업」 area this screen used to open with is therefore gone: its rows are 확인할 일's rows, its
 * 「작업에서 제외」 stands in the Review Case, and its history sits under 확인할 일. This screen links there once.
 *
 * <p><b>One record screen.</b> The per-account record (`/reviews/:accountId`) redirects here with its channel as the
 * filter; its read detail — the facts, the seller's standing answer, `[쿠팡에서 보기]`, the AI pilot's silver — is
 * this screen's right-hand pane now ({@link ReviewReadDetail}). A review that 고객 운영 관리 opened a case about is
 * shown as that case, in the same grammar, because the case is where its judgement already is.
 *
 * <p>One read orders, filters, pages and counts (`GET /api/reviews/record`); nothing is merged here.
 */
export function ReviewRecord({ targets, head }: { targets: ReviewAccount[]; head?: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { search } = useLocation();
  const rawTier = searchParams.get("tier");
  const tier = parseTierParam(rawTier);
  const channel = normalizeChannel(searchParams.get("channel"));
  const selectedId = searchParams.get("review");
  const wide = useWideLayout();
  const [sort, setSort] = useState<Sort>("attention");
  const [pageIndex, setPageIndex] = useState(0);
  const [page, setPage] = useState<ReviewRecordPageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [workCount, setWorkCount] = useState<number | null>(null);
  const [cases, setCases] = useState<Map<string, string>>(new Map());
  const seq = useRef(0);

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value) params.set(key, value);
            else params.delete(key);
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // An unknown tier is scrubbed rather than sent — the server would refuse it, and the screen would say nothing.
  useEffect(() => {
    if (rawTier !== null && tier === null) setParams({ tier: null });
  }, [rawTier, tier, setParams]);

  const recordBehavior = useCallback((accountId: string | null, events: TriageBehaviorEvent[]) => {
    if (!accountId || events.length === 0) return;
    try {
      void Promise.resolve(api.recordChannelReviewTriageBehavior(accountId, events)).catch(() => undefined);
    } catch {
      // Silver: never fails the screen.
    }
  }, []);

  const load = useCallback(
    async (nextSort: Sort, nextTier: ReviewTriageTier | null, nextChannel: string | null, nextPage: number) => {
      const ticket = ++seq.current;
      setLoading(true);
      try {
        const view = await api.getReviewRecordStrict({
          channel: nextChannel ?? undefined,
          sort: nextSort,
          tier: nextTier ?? undefined,
          page: nextPage,
          size: PAGE_SIZE,
        });
        if (ticket !== seq.current) return;
        setPage(view);
        setLoadError(false);
        // The pilot's exposure silver, per account, for rows the pilot raised — as the channel record did.
        if (view.aiPilotEnabled) {
          for (const facts of view.channelFacts ?? []) {
            if (!facts.capability?.aiTriage) continue;
            recordBehavior(
              facts.accountId,
              view.items
                .filter((row) => row.channelCode === facts.channelCode && row.review.aiMark !== null)
                .map((row) => ({ reviewId: row.review.id, kind: "AI_ATTENTION_SHOWN" as const })),
            );
          }
        }
      } catch {
        if (ticket !== seq.current) return;
        setPage(null);
        setLoadError(true);
      } finally {
        if (ticket === seq.current) setLoading(false);
      }
    },
    [recordBehavior],
  );

  useEffect(() => {
    void load(sort, tier, channel, pageIndex);
  }, [sort, tier, channel, pageIndex, load]);

  // How much review work 확인할 일 holds — the one link to the work from a record screen. And which reviews have a
  // case, so the pane can show the case rather than a second reading of the same review. Both fail silent.
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.getReviewWorkStrict())
      .then((work) => {
        if (!live) return;
        const committed = work.committed.reduce((n, account) => n + account.todo.length, 0);
        setWorkCount(work.attentionTotal + committed);
      })
      .catch(() => live && setWorkCount(null));
    Promise.resolve()
      .then(() => api.getCustomerOperationsDecisions())
      .then((d) => {
        if (!live) return;
        // Keyed by the owner address — the identity 확인할 일 dedupes by — so no URL is parsed back into an id.
        const map = new Map<string, string>();
        for (const row of d.rows) if (row.subjectKind === "REVIEW") map.set(row.to, row.caseId);
        setCases(map);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const channelChoices = uniqueChannels(targets);
  const totalPages = page === null || page.size <= 0 ? 1 : Math.max(1, Math.ceil(page.total / page.size));
  const recordTotal = page ? page.triageSummary.needsAttention + page.triageSummary.watch + page.triageSummary.fyi : 0;
  const selectedRow = page?.items.find((row) => row.review.id === selectedId) ?? null;
  const shownId = selectedId ?? (wide ? page?.items[0]?.review.id ?? null : null);
  const shownRow = page?.items.find((row) => row.review.id === shownId) ?? selectedRow;
  const hrefFor = (reviewId: string) => {
    const params = new URLSearchParams(search);
    params.set("review", reviewId);
    return `?${params.toString()}`;
  };

  const detail = shownId ? (
    cases.has(ownerOf(shownId)) ? (
      <OperationsCaseView key={shownId} caseId={cases.get(ownerOf(shownId))!} variant="pane" />
    ) : (
      <ReviewReadPane
        key={shownId}
        reviewId={shownId}
        facts={page?.channelFacts?.find((f) => f.channelCode === shownRow?.channelCode) ?? null}
        aiPilotEnabled={page?.aiPilotEnabled ?? false}
        recordBehavior={recordBehavior}
      />
    )
  ) : null;

  const record = (
    <>
      {head}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* 채널은 필터. 「전체」 is the seller-visible channels — and when the organisation holds reviews elsewhere
            (a file-uploaded G마켓 export), the line below says so rather than letting 「전체」 claim them. */}
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-canvas p-0.5" role="group" aria-label="채널 필터">
          <SegmentBtn pressed={channel === null} onClick={() => { setParams({ channel: null, review: null }); setPageIndex(0); }}>
            전체
          </SegmentBtn>
          {channelChoices.map((code) => (
            <SegmentBtn
              key={code}
              pressed={channel === code}
              onClick={() => {
                setParams({ channel: code, review: null });
                setPageIndex(0);
              }}
            >
              {channelShort(code) ?? code}
            </SegmentBtn>
          ))}
        </div>
        {workCount && workCount > 0 ? (
          <Link to="/customer-operations/cases" className="text-sm font-semibold text-brand-700 hover:underline">
            {COPY.listTitle}에 리뷰 {workCount.toLocaleString("ko-KR")}건 →
          </Link>
        ) : null}
      </div>

      {page ? (
        <Facts className="text-sm text-muted">
          <span className="tabular-nums">{`총 ${recordTotal}개`}</span>
          {page.newCount > 0 ? <span className="font-semibold tabular-nums text-brand-700">{`새로 들어온 ${page.newCount}개`}</span> : null}
          {(page.outsideVisibleChannels ?? 0) > 0 && channel === null ? (
            <span>
              연결 채널(네이버·쿠팡·카페24) 기준 · 파일로 올린 다른 채널 리뷰 {page.outsideVisibleChannels}건은 상품 화면에서 봅니다
            </span>
          ) : null}
        </Facts>
      ) : null}

      {/* What the record's automatic classification sees most — a fact about the record, kept from the old summary
          card as one line. Not 「반복 문제」: that is the issue memory's word and a different mechanism. */}
      {page && page.triageSummary.repeatedCategories.length > 0 ? (
        <div className="text-sm text-muted">
          <Facts>
            <span>같은 자동 분류가 많은 리뷰</span>
            {page.triageSummary.repeatedCategories.map((c) => (
              <span key={c.category} className="font-semibold tabular-nums text-ink">{`${c.category} ${c.count}건`}</span>
            ))}
          </Facts>
          <Disclosure label="분류 기준" className="mt-1" summaryClassName="px-0 text-sm">
            <p className="mt-1 break-keep text-sm text-muted">{TRIAGE_TAG_DISCLOSURE}</p>
          </Disclosure>
        </div>
      ) : null}

      {/* What only a channel can say: an import that stopped before the end of its list. */}
      {(page?.channelFacts ?? [])
        .filter((f) => f.lastImportAt && !f.lastImportComplete)
        .map((f) => (
          <p key={f.channelCode} className="rounded-xl border border-line bg-canvas px-4 py-3 text-sm leading-relaxed text-muted">
            {channelShort(f.channelCode) ?? f.channelNameKo}: 마지막 수집({formatDateTime(f.lastImportAt!)})이 목록 끝까지
            확인되지 않은 상태로 끝났습니다. 채널에 이보다 더 있을 수 있습니다.
          </p>
        ))}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-canvas p-0.5" role="group" aria-label="분류 필터">
          {TRIAGE_TIERS.map((value) => (
            <SegmentBtn
              key={value}
              pressed={tier === value}
              onClick={() => {
                setParams({ tier: value, review: null });
                setPageIndex(0);
              }}
            >
              {TRIAGE_TIER_LABEL[value]} {page ? tierCount(page, value) : 0}
            </SegmentBtn>
          ))}
          <SegmentBtn
            pressed={tier === null}
            onClick={() => {
              setParams({ tier: null, review: null });
              setPageIndex(0);
            }}
          >
            전체 {recordTotal}
          </SegmentBtn>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-canvas p-0.5" role="group" aria-label="정렬">
          {(
            [
              ["attention", "확인 필요순"],
              ["newest", "최신순"],
              ["lowest", "낮은 평점순"],
            ] as const
          ).map(([value, label]) => (
            <SegmentBtn
              key={value}
              pressed={sort === value}
              onClick={() => {
                setSort(value);
                setPageIndex(0);
                setParams({ review: null });
              }}
            >
              {label}
            </SegmentBtn>
          ))}
        </div>
      </div>

      {loadError ? (
        <Empty
          title="리뷰를 불러오지 못했습니다"
          body="연결 상태를 확인한 뒤 다시 시도해 주세요. 불러오지 못한 목록을 임의로 채우지는 않습니다."
          action={
            <Btn size="sm" onClick={() => void load(sort, tier, channel, pageIndex)}>
              다시 시도
            </Btn>
          }
        />
      ) : loading && !page ? (
        <p className="text-muted">불러오는 중…</p>
      ) : page && page.items.length === 0 && tier !== null ? (
        // An empty FILTER is not an empty record.
        <Empty
          title={`${TRIAGE_TIER_LABEL[tier]}에 해당하는 ${josa(WORD, "이", "가")} 없습니다`}
          body={`다른 분류를 눌러 보시거나 전체를 보세요. 수집된 ${josa(WORD, "은", "는")} 그대로 있습니다.`}
          action={
            <Btn size="sm" onClick={() => setParams({ tier: null })}>
              전체 보기
            </Btn>
          }
        />
      ) : page && page.items.length === 0 ? (
        <Empty
          title={`아직 수집된 ${josa(WORD, "이", "가")} 없습니다`}
          body="채널 연결에서 리뷰 수집을 한 번 실행하면 이 목록에 쌓입니다."
          action={
            <BtnLink to="/connect" size="sm">
              채널 연결로
            </BtnLink>
          }
        />
      ) : page ? (
        <Section title="목록" hint={rangeLabel(page)}>
          <ListBox>
            <ul className="divide-y divide-line/70">
              {page.items.map(({ channelCode, channelNameKo, review }) => {
                const selected = review.id === shownId;
                return (
                  <li key={review.id}>
                    <Link
                      to={hrefFor(review.id)}
                      aria-current={selected ? "true" : undefined}
                      className={`block px-4 py-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700 ${
                        selected ? "bg-brand-50 shadow-[inset_3px_0_0_#1B64DA]" : "hover:bg-canvas"
                      }`}
                    >
                      {/* Three lines: state · stars · where and when; what the buyer wrote; the product. The rule's
                          reason belongs to the review itself, where it explains a decision. */}
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <TriageTierChip tier={review.triage.tier} />
                        {review.aiMark ? <AiMarkChip /> : null}
                        {review.sellerCorrection ? <SellerCorrectionChip tier={review.sellerCorrection.correctedTier} /> : null}
                        <span className="text-sm font-semibold tabular-nums text-ink">{ratingLabel(review.rating)}</span>
                        <span className="text-sm text-muted">
                          {channelShort(channelCode) ?? channelNameKo ?? "채널 미상"} · {review.writtenOn ?? "날짜 없음"}
                        </span>
                        {cases.has(ownerOf(review.id)) ? <Chip tone="accent">{COPY.listTitle}</Chip> : null}
                        {review.isNew ? <Chip tone="accent">새 리뷰</Chip> : null}
                        {review.mediaCount > 0 ? <Chip>사진·영상 {review.mediaCount}</Chip> : null}
                      </span>
                      <span
                        className={`mt-0.5 block break-keep text-base font-semibold leading-snug ${review.textless ? "font-normal text-muted" : "text-ink"}`}
                      >
                        {review.textless ? "별점만 남긴 리뷰" : previewText(review.preview) || "표시할 수 있는 본문이 없습니다"}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-muted">
                        {review.productName ?? review.productId ?? "상품 정보 없음"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {totalPages > 1 ? (
              <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3" aria-label="리뷰 목록 페이지">
                <Btn
                  size="sm"
                  variant="outline"
                  disabled={pageIndex <= 0 || loading}
                  onClick={() => {
                    setPageIndex((n) => Math.max(0, n - 1));
                    setParams({ review: null });
                  }}
                >
                  이전
                </Btn>
                <span className="text-sm text-muted">
                  {page.page + 1} / {totalPages} 페이지
                </span>
                <Btn
                  size="sm"
                  variant="outline"
                  disabled={pageIndex >= totalPages - 1 || loading}
                  onClick={() => {
                    setPageIndex((n) => n + 1);
                    setParams({ review: null });
                  }}
                >
                  다음
                </Btn>
              </nav>
            ) : null}
          </ListBox>
        </Section>
      ) : null}
    </>
  );

  const list =
    !wide && selectedId ? (
      <>
        {head}
        <button
          type="button"
          onClick={() => setParams({ review: null })}
          className="text-left text-sm font-semibold text-muted hover:text-ink hover:underline"
        >
          ← 리뷰 목록
        </button>
        {detail}
      </>
    ) : (
      record
    );

  return <MasterDetail wide={wide} list={list} detailLabel="리뷰 상세" detail={detail} />;
}

/**
 * One review, read — the old channel record's detail, in the pane. Reads the review by its own id (org-scoped), and
 * acts through the one account the channel facts name: `[쿠팡에서 보기]` and the pilot's silver are account-bound.
 */
function ReviewReadPane({
  reviewId,
  facts,
  aiPilotEnabled,
  recordBehavior,
}: {
  reviewId: string;
  facts: ReviewRecordChannelFacts | null;
  aiPilotEnabled: boolean;
  recordBehavior: (accountId: string | null, events: TriageBehaviorEvent[]) => void;
}) {
  const [detail, setDetail] = useState<ChannelReviewDetailView | null | undefined>(undefined);
  const accountId = detail?.sellerAccountId ?? facts?.accountId ?? null;
  const locate = useReviewLocate(accountId ?? "");
  const capability = facts?.capability ?? null;
  const pilotOn = aiPilotEnabled && (capability?.aiTriage ?? false);

  useEffect(() => {
    let live = true;
    api
      .getReviewWorkspace(reviewId)
      .then((view) => live && setDetail(view))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [reviewId]);

  useEffect(() => {
    if (detail && pilotOn && (detail.aiMark !== null || detail.triage.tier === "NEEDS_ATTENTION")) {
      recordBehavior(accountId, [{ reviewId: detail.id, kind: "REVIEW_OPENED" }]);
    }
  }, [detail, pilotOn, accountId, recordBehavior]);

  const record = useCallback((events: TriageBehaviorEvent[]) => recordBehavior(accountId, events), [recordBehavior, accountId]);
  const title = useMemo(() => {
    if (!detail) return "리뷰";
    const body = detail.body ? plainText(detail.body).trim() : "";
    return detail.textless || body.length === 0 ? "별점만 남긴 리뷰" : body;
  }, [detail]);

  if (detail === undefined) return <p className="text-sm text-muted">불러오는 중…</p>;
  if (detail === null) return <p className="text-muted">리뷰를 불러오지 못했습니다.</p>;

  return (
    <CaseLayout
      variant="pane"
      label="선택한 리뷰"
      decisionLabel="읽기"
      meta={
        <Facts>
          <span>{channelShort(facts?.channelCode) ?? facts?.channelNameKo ?? "리뷰"}</span>
          <span className="tabular-nums">{detail.writtenOn ?? "날짜 없음"}</span>
        </Facts>
      }
      title={title}
      sub={detail.productName ?? undefined}
      decision={
        <ReviewReadDetail
          showBody={false}
          pilotOn={pilotOn}
          capability={capability}
          word={WORD}
          recordBehavior={record}
          detail={detail}
          locate={locate}
          run={locate.reviewId === detail.id ? locate.view : null}
          running={locate.reviewId === detail.id && locate.starting}
          unavailable={locate.reviewId === detail.id ? locate.unavailable : null}
        />
      }
    />
  );
}

/** The review's owner address — the key a case names its subject by. */
function ownerOf(reviewId: string): string {
  return `/reviews/reply/${reviewId}`;
}

function tierCount(page: ReviewRecordPageView, tier: ReviewTriageTier): number {
  if (tier === "NEEDS_ATTENTION") return page.triageSummary.needsAttention;
  if (tier === "WATCH") return page.triageSummary.watch;
  return page.triageSummary.fyi;
}

/** Which slice of the list is on screen, from the response — never from local state. */
export function rangeLabel(page: ReviewRecordPageView | null): string {
  if (page === null || page.items.length === 0) return "0개 표시 중";
  const first = page.page * page.size + 1;
  return `${first}–${first + page.items.length - 1}번째 · 총 ${page.total}개`;
}

function normalizeChannel(value: string | null): string | null {
  if (!value) return null;
  const code = value.toUpperCase();
  return ["NAVER", "COUPANG", "CAFE24"].includes(code) ? code : null;
}

function uniqueChannels(targets: ReviewAccount[]): string[] {
  const order = ["NAVER", "COUPANG", "CAFE24"];
  const codes = new Set(targets.map((t) => t.channel.code));
  return order.filter((c) => codes.has(c));
}
