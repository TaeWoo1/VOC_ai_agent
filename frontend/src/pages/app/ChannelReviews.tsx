import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Panel } from "../../components/ui/Panel";
import { Empty } from "../../components/ui/Empty";
import { Chip } from "../../components/ui/Chip";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { api } from "../../lib/apiClient";
import type { ChannelReviewDetailView, ChannelReviewPageView } from "../../lib/types";

/**
 * **상품평** — the seller's own record of what buyers wrote on a connected channel.
 *
 * It is a record, not a work queue, and the difference is visible in what is missing. There is no
 * reply control, no draft, no "답변하기": Coupang gives sellers no way to answer a 상품평, and an
 * affordance for a capability the channel does not have would be a promise the product cannot keep.
 * The one ordering concession is 낮은 평점순, which surfaces complaints without calling them tasks.
 *
 * **The page says what it does not know.** A list of reviews cannot tell a seller whether it is all
 * of their reviews — an import that stopped early looks exactly like a channel with fewer reviews.
 * So the last import's own coverage claim is rendered, and an incomplete one says so in words rather
 * than being left for the seller to infer from a number that looks fine.
 *
 * No buyer name appears anywhere, because none is stored: the acquisition path locates that column
 * on the screen precisely so it can refuse to read it.
 */
/** One screenful. The backend takes it as `size`; the FE never assumes the server used it. */
const PAGE_SIZE = 20;

/**
 * "21–22번째 · 총 22개" — which slice of the list is on screen. Derived from what the RESPONSE says its
 * page and size were, not from what was asked for: a server that clamped the size would otherwise be
 * described by a label that quietly disagreed with the rows under it.
 */
export function shownRangeLabel(page: ChannelReviewPageView | null): string {
  if (page === null || page.items.length === 0) return "0개 표시 중";
  const first = page.page * page.size + 1;
  return `${first}–${first + page.items.length - 1}번째 · 총 ${page.total}개`;
}

export function ChannelReviews() {
  const { accountId = "" } = useParams();

  const [sort, setSort] = useState<"newest" | "lowest">("newest");
  const [pageIndex, setPageIndex] = useState(0);
  const [page, setPage] = useState<ChannelReviewPageView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChannelReviewDetailView | null>(null);
  const [detailError, setDetailError] = useState(false);

  const load = useCallback(
    async (nextSort: "newest" | "lowest", nextPage: number) => {
      setLoading(true);
      try {
        setPage(
          await api.getChannelReviewsStrict(accountId, { sort: nextSort, page: nextPage, size: PAGE_SIZE }),
        );
        setLoadError(false);
      } catch {
        // Fail closed: an unreachable backend shows nothing, never an invented list. The seller has
        // no other copy of what buyers wrote to check a fabrication against.
        setPage(null);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [accountId],
  );

  useEffect(() => {
    if (!accountId) return;
    void load(sort, pageIndex);
  }, [accountId, sort, pageIndex, load]);

  useEffect(() => {
    if (!accountId || !selectedId) {
      setDetail(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const view = await api.getChannelReviewStrict(accountId, selectedId);
        if (live) {
          setDetail(view);
          setDetailError(false);
        }
      } catch {
        if (live) {
          setDetail(null);
          setDetailError(true);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [accountId, selectedId]);

  // Ceiling division on the size the SERVER reported, for the same reason the label uses it.
  const totalPages = page === null || page.size <= 0 ? 1 : Math.max(1, Math.ceil(page.total / page.size));

  return (
    <div className="space-y-6">
      <PageHead
        title="상품평"
        description="연결된 채널에서 수집한 구매자 상품평입니다. 쿠팡은 판매자 답글 기능이 없어 답변 작성 기능은 제공하지 않습니다."
        meta={
          page ? (
            <>
              <Chip>총 {page.total}개</Chip>
              {page.newCount > 0 ? <Chip tone="accent">새로 들어온 {page.newCount}개</Chip> : null}
              {page.lastImportAt ? (
                <Chip>마지막 수집 {formatDateTime(page.lastImportAt)}</Chip>
              ) : (
                <Chip>수집 기록 없음</Chip>
              )}
            </>
          ) : undefined
        }
        action={
          <BtnLink to={`/connect/channels/${accountId}`} variant="outline" size="sm">
            채널 설정
          </BtnLink>
        }
      />

      {page && page.lastImportAt && !page.lastImportComplete ? (
        <p className="rounded-xl border border-line bg-canvas px-4 py-3 text-sm leading-relaxed text-muted">
          마지막 수집이 목록 끝까지 확인되지 않은 상태로 끝났습니다. 아래 목록은 지금까지 가져온
          상품평이며, 채널에 이보다 더 있을 수 있습니다.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Btn
          variant={sort === "newest" ? "solid" : "outline"}
          size="sm"
          aria-pressed={sort === "newest"}
          onClick={() => {
            setSort("newest");
            setPageIndex(0);
          }}
        >
          최신순
        </Btn>
        <Btn
          variant={sort === "lowest" ? "solid" : "outline"}
          size="sm"
          aria-pressed={sort === "lowest"}
          onClick={() => {
            setSort("lowest");
            setPageIndex(0);
          }}
        >
          낮은 평점순
        </Btn>
      </div>

      {loadError ? (
        <Empty
          title="상품평을 불러오지 못했습니다"
          body="연결 상태를 확인한 뒤 다시 시도해 주세요. 불러오지 못한 목록을 임의로 채우지는 않습니다."
          action={
            <Btn size="sm" onClick={() => void load(sort, pageIndex)}>
              다시 시도
            </Btn>
          }
        />
      ) : loading && !page ? (
        <p className="text-muted">불러오는 중…</p>
      ) : page && page.items.length === 0 ? (
        <Empty
          title="아직 수집된 상품평이 없습니다"
          body="채널 설정에서 상품평 수집을 한 번 실행하면 이 목록에 쌓입니다."
          action={
            <BtnLink to={`/connect/channels/${accountId}`} size="sm">
              채널 설정으로
            </BtnLink>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <Panel title="목록" description={shownRangeLabel(page)}>
            <ul className="divide-y divide-line">
              {(page?.items ?? []).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-current={selectedId === item.id ? "true" : undefined}
                    className={`w-full rounded-lg px-2 py-3 text-left transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${
                      selectedId === item.id ? "bg-canvas" : ""
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{ratingLabel(item.rating)}</span>
                      <span className="text-sm text-muted">{item.writtenOn ?? "날짜 없음"}</span>
                      {item.isNew ? <Chip tone="accent">새 상품평</Chip> : null}
                      {item.mediaCount > 0 ? <Chip>사진·영상 {item.mediaCount}</Chip> : null}
                    </span>
                    <span
                      className={`mt-1 block break-keep text-base ${item.textless ? "text-muted" : "text-ink"}`}
                    >
                      {/* A textless review is what the buyer chose, not something we failed to show. */}
                      {item.textless ? "별점만 남긴 상품평" : (item.preview ?? "표시할 수 있는 본문이 없습니다")}
                    </span>
                    <span className="mt-1 block truncate text-sm text-muted">
                      {item.productName ?? item.productId ?? "상품 정보 없음"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/*
              **The list is paged, and the paging is visible.** Without this the page showed the first 20 and
              nothing said so — a seller with 22 상품평 read "총 22개" over a list of 20 and had no way to
              reach the other two. The buttons move the window; the label says which window is open.
            */}
            {totalPages > 1 ? (
              <nav className="mt-4 flex items-center justify-between gap-3" aria-label="상품평 목록 페이지">
                <Btn
                  size="sm"
                  variant="outline"
                  disabled={pageIndex <= 0 || loading}
                  onClick={() => setPageIndex((n) => Math.max(0, n - 1))}
                >
                  이전
                </Btn>
                <span className="text-sm text-muted">
                  {pageIndex + 1} / {totalPages} 페이지
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
          </Panel>

          <Panel title="상세" description={selectedId ? undefined : "왼쪽에서 상품평을 선택하세요"}>
            {detailError ? (
              <p className="text-muted">상품평을 불러오지 못했습니다.</p>
            ) : detail ? (
              <ReviewDetail detail={detail} />
            ) : selectedId ? (
              <p className="text-muted">불러오는 중…</p>
            ) : (
              <p className="text-muted">선택한 상품평의 전체 내용이 여기에 표시됩니다.</p>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function ReviewDetail({ detail }: { detail: ChannelReviewDetailView }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{ratingLabel(detail.rating)}</span>
        <span className="text-sm text-muted">{detail.writtenOn ?? "날짜 없음"}</span>
        {detail.isNew ? <Chip tone="accent">새 상품평</Chip> : null}
        {detail.mediaCount > 0 ? <Chip>사진·영상 {detail.mediaCount}</Chip> : null}
      </div>
      {detail.textless ? (
        <p className="break-keep leading-relaxed text-muted">
          별점만 남기고 내용을 쓰지 않은 상품평입니다. 별점은 그대로 집계됩니다.
        </p>
      ) : (
        <p className="whitespace-pre-wrap break-keep leading-relaxed text-ink">
          {detail.body ?? "표시할 수 있는 본문이 없습니다"}
        </p>
      )}
      {detail.bodyRedacted ? (
        <p className="text-sm text-muted">
          연락처·링크처럼 개인정보로 보이는 부분은 가려서 표시했습니다.
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">상품</dt>
        <dd className="truncate text-ink">{detail.productName ?? "정보 없음"}</dd>
        <dt className="text-muted">노출상품ID</dt>
        <dd className="truncate text-ink">{detail.locateTarget.productId ?? "정보 없음"}</dd>
        <dt className="text-muted">옵션ID</dt>
        <dd className="truncate text-ink">{detail.locateTarget.vendorItemId ?? "정보 없음"}</dd>
      </dl>
    </div>
  );
}

/** A rating renders as its number plus stars; an unread rating says so rather than showing zero stars. */
function ratingLabel(rating: number | null): string {
  if (rating === null) return "평점 없음";
  return `${"★".repeat(rating)}${"☆".repeat(Math.max(0, 5 - rating))} ${rating}점`;
}

function formatDateTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.getFullYear()}.${pad(at.getMonth() + 1)}.${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
