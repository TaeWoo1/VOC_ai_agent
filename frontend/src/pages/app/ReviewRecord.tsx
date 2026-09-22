import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Section, ListBox } from "../../components/ui/Section";
import { Facts } from "../../components/ui/ObjectRow";
import { Empty } from "../../components/ui/Empty";
import { Chip } from "../../components/ui/Chip";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { MyReplyWork } from "../../components/MyReplyWork";
import { AiMarkChip, TriageTierChip } from "../../components/reviews/TriageTierChip";
import { api } from "../../lib/apiClient";
import { ratingLabel } from "../../lib/reviewRecord";
import { previewText } from "../../lib/plainText";
import { channelShort } from "../../lib/copy/customerOps";
import { TRIAGE_TIERS, TRIAGE_TIER_LABEL } from "../../lib/reviewTriage";
import type { ReviewAccount } from "../../lib/reviewAccounts";
import type { ReviewRecordPageView, ReviewTriageTier } from "../../lib/types";
import { SegmentBtn, SellerCorrectionChip, TriageSummary, josa, parseTierParam } from "./ChannelReviews";

const PAGE_SIZE = 20;
const WORD = "리뷰";

type Sort = "attention" | "newest" | "lowest";

/**
 * <b>리뷰 — the organisation's record, every channel at once</b> (UI/UX v2 Phase 2).
 *
 * <p>The seller used to land on ONE account's record — the first connected one — and switch channels with tabs, so
 * the first question the 리뷰 screen answered was 「어느 채널?」, which is the opposite of how this product is
 * assembled. Now the default is every seller-visible channel, and a channel is a filter (`?channel=`).
 *
 * <p><b>Nothing is merged here.</b> One read — `GET /api/reviews/record` — orders, filters, pages and counts, with
 * the same tier rank, the same tier filter, the same three sorts and the same summary the channel record uses.
 * Rows open the Review Case, which is where every decision about a review is taken; this screen writes nothing.
 *
 * <p><b>What stays on the channel record</b> (`/reviews/:accountId`): what only one account can answer — its last
 * import, `[쿠팡에서 보기]`, the AI pilot's per-account controls. The seller's 답변 작업 is per account too, so it is
 * drawn here once per account that has a reply flow, each under its own channel's name — separate lists, never one
 * merged list.
 */
export function ReviewRecord({ targets }: { targets: ReviewAccount[] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tier = parseTierParam(searchParams.get("tier"));
  const channel = normalizeChannel(searchParams.get("channel"));
  const [sort, setSort] = useState<Sort>("attention");
  const [pageIndex, setPageIndex] = useState(0);
  const [page, setPage] = useState<ReviewRecordPageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const seq = useRef(0);

  const setParam = useCallback(
    (key: "tier" | "channel", value: string | null) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (value) params.set(key, value);
          else params.delete(key);
          return params;
        },
        { replace: true },
      );
      setPageIndex(0);
    },
    [setSearchParams],
  );

  const load = useCallback(async (nextSort: Sort, nextTier: ReviewTriageTier | null, nextChannel: string | null, nextPage: number) => {
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
    } catch {
      if (ticket !== seq.current) return;
      setPage(null);
      setLoadError(true);
    } finally {
      if (ticket === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(sort, tier, channel, pageIndex);
  }, [sort, tier, channel, pageIndex, load]);

  // The channels a seller can filter to: the ones they hold an account on, in product order. A channel with no
  // account has no record to narrow to on this screen.
  const channelChoices = uniqueChannels(targets);
  const replyAccounts = targets.filter((t) => channel === null || t.channel.code === channel);
  const totalPages = page === null || page.size <= 0 ? 1 : Math.max(1, Math.ceil(page.total / page.size));
  const recordTotal = page ? page.triageSummary.needsAttention + page.triageSummary.watch + page.triageSummary.fyi : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* 채널은 필터 — the record is the organisation's, and a channel narrows it. */}
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-canvas p-0.5" role="group" aria-label="채널 필터">
          <SegmentBtn pressed={channel === null} onClick={() => setParam("channel", null)}>
            전체 채널
          </SegmentBtn>
          {channelChoices.map((code) => (
            <SegmentBtn key={code} pressed={channel === code} onClick={() => setParam("channel", code)}>
              {channelShort(code) ?? code}
            </SegmentBtn>
          ))}
        </div>
        {page ? (
          <Facts className="text-sm text-muted">
            <span className="tabular-nums">{`총 ${recordTotal}개`}</span>
            {page.newCount > 0 ? <span className="font-semibold tabular-nums text-brand-700">{`새로 들어온 ${page.newCount}개`}</span> : null}
            <span>답변은 리뷰를 열어 준비하고, 올리는 일은 판매자센터에서 직접 합니다</span>
          </Facts>
        ) : null}
      </div>

      {/* The seller's own committed reply work — one list per account that has a reply flow, each named. */}
      <ReplyWorkByAccount targets={replyAccounts} />

      {page ? (
        <TriageSummary
          summary={page.triageSummary}
          newCount={page.newCount}
          word={WORD}
          showOnlyAttention={tier === "NEEDS_ATTENTION" ? null : () => setParam("tier", "NEEDS_ATTENTION")}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-canvas p-0.5" role="group" aria-label="분류 필터">
          {TRIAGE_TIERS.map((value) => (
            <SegmentBtn key={value} pressed={tier === value} onClick={() => setParam("tier", value)}>
              {TRIAGE_TIER_LABEL[value]} {page ? tierCount(page, value) : 0}
            </SegmentBtn>
          ))}
          <SegmentBtn pressed={tier === null} onClick={() => setParam("tier", null)}>
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
            <Btn size="sm" onClick={() => setParam("tier", null)}>
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
              {page.items.map(({ channelCode, channelNameKo, review }) => (
                <li key={review.id}>
                  <Link
                    to={`/reviews/reply/${review.id}?from=record`}
                    className="block px-4 py-3 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
                  >
                    {/* Three lines (UI/UX v2): state · stars · where and when; what the buyer wrote; the product.
                        The rule's reason and advice belong to the review itself, where they explain a decision —
                        repeated on every row they were the same sentence twenty times. */}
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <TriageTierChip tier={review.triage.tier} />
                      {review.aiMark ? <AiMarkChip /> : null}
                      {review.sellerCorrection ? <SellerCorrectionChip tier={review.sellerCorrection.correctedTier} /> : null}
                      <span className="text-sm font-semibold tabular-nums text-ink">{ratingLabel(review.rating)}</span>
                      <span className="text-sm text-muted">
                        {channelShort(channelCode) ?? channelNameKo ?? "채널 미상"} · {review.writtenOn ?? "날짜 없음"}
                      </span>
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
              ))}
            </ul>
            {totalPages > 1 ? (
              <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3" aria-label="리뷰 목록 페이지">
                <Btn size="sm" variant="outline" disabled={pageIndex <= 0 || loading} onClick={() => setPageIndex((n) => Math.max(0, n - 1))}>
                  이전
                </Btn>
                <span className="text-sm text-muted">
                  {page.page + 1} / {totalPages} 페이지
                </span>
                <Btn
                  size="sm"
                  variant="outline"
                  disabled={pageIndex >= totalPages - 1 || loading}
                  onClick={() => setPageIndex((n) => n + 1)}
                >
                  다음
                </Btn>
              </nav>
            ) : null}
          </ListBox>
        </Section>
      ) : null}
    </div>
  );
}

/**
 * The 답변 작업 of each account whose channel has a reply flow — asked of the server, one size-1 read per account
 * (the shape ConnectHub already uses for a total), never inferred from the channel code.
 */
function ReplyWorkByAccount({ targets }: { targets: ReviewAccount[] }) {
  const [replyable, setReplyable] = useState<ReviewAccount[]>([]);
  const ids = targets.map((t) => t.account.id).join(",");
  useEffect(() => {
    let live = true;
    Promise.all(
      targets.map((t) =>
        api
          .getChannelReviewsStrict(t.account.id, { size: 1 })
          .then((view) => (view.channel.replySupported ? t : null))
          .catch(() => null),
      ),
    ).then((found) => {
      if (live) setReplyable(found.filter((t): t is ReviewAccount => t !== null));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  if (replyable.length === 0) return null;
  return (
    <>
      {replyable.map((t) => (
        <MyReplyWork key={t.account.id} accountId={t.account.id} title={`내 답변 작업 · ${t.label}`} />
      ))}
    </>
  );
}

function tierCount(page: ReviewRecordPageView, tier: ReviewTriageTier): number {
  if (tier === "NEEDS_ATTENTION") return page.triageSummary.needsAttention;
  if (tier === "WATCH") return page.triageSummary.watch;
  return page.triageSummary.fyi;
}

function rangeLabel(page: ReviewRecordPageView): string {
  if (page.items.length === 0) return "0개 표시 중";
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
