import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Panel } from "../../components/ui/Panel";
import { Empty } from "../../components/ui/Empty";
import { Chip } from "../../components/ui/Chip";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { api } from "../../lib/apiClient";
import type {
  ChannelReviewDetailView,
  ChannelReviewPageView,
  ReviewTriageNote,
  ReviewTriageTier,
} from "../../lib/types";
import {
  TRIAGE_TAG_DISCLOSURE,
  TRIAGE_TIERS,
  TRIAGE_TIER_CLASS,
  TRIAGE_TIER_LABEL,
} from "../../lib/reviewTriage";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import { locateMessage, locateUnavailableText } from "../../lib/actionWindow/locate/locateCopy";
import {
  useReviewLocate,
  type LocateUnavailable,
  type ReviewLocateBinding,
} from "../../lib/actionWindow/locate/useReviewLocate";

/**
 * **상품평** — the seller's own record of what buyers wrote on a connected channel.
 *
 * It is a record, not a work queue, and the difference is visible in what is missing. There is no
 * reply control, no draft, no "답변하기": Coupang gives sellers no way to answer a 상품평, and an
 * affordance for a capability the channel does not have would be a promise the product cannot keep.
 *
 * **Review Triage v1 added an order and an explanation, not a queue.** The list opens 확인 필요 순,
 * every row says which tier it is in and why, and the summary says how the whole record divides.
 * Nothing is hidden unless the seller presses a filter, nothing is marked done, and no tier promises
 * that anything happens next — see `docs/slices/review-triage-v1.md`.
 *
 * **The tier comes from the rating and whether there is text to read, and from nothing else.** The
 * 분류 tags beside it are a stored keyword classification with unmeasured accuracy, so they are
 * rendered as citations under one plain disclosure and must never be used here to re-rank, re-colour
 * or re-sort a row. That boundary is `contracts/review-eval/naver/v1/RUBRIC.md` §5.
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

export function ChannelReviews({ locateBinding }: { locateBinding?: ReviewLocateBinding } = {}) {
  const { accountId = "" } = useParams();
  /**
   * `[쿠팡에서 보기]`. Inert until pressed: no agent socket is opened for a seller who only reads the list.
   * The optional prop is the test seam — a rendered page never has to reach a bridge to be exercised.
   */
  const attached = useReviewLocate(accountId);
  const locate = locateBinding ?? attached;

  const [sort, setSort] = useState<"attention" | "newest" | "lowest">("attention");
  const [tier, setTier] = useState<ReviewTriageTier | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [page, setPage] = useState<ChannelReviewPageView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChannelReviewDetailView | null>(null);
  const [detailError, setDetailError] = useState(false);

  /**
   * **Only the newest request may write.** Two controls now change the query — the order and the page — so
   * two reads can be in flight at once, and the slower one landing second would install rows that neither
   * the pressed sort button nor the pager label describes. A monotonic ticket makes a superseded response
   * inert rather than merely unlikely.
   */
  const requestSeq = useRef(0);

  const load = useCallback(
    async (
      nextSort: "attention" | "newest" | "lowest",
      nextTier: ReviewTriageTier | null,
      nextPage: number,
    ) => {
      const ticket = ++requestSeq.current;
      setLoading(true);
      try {
        const view = await api.getChannelReviewsStrict(accountId, {
          sort: nextSort,
          tier: nextTier ?? undefined,
          page: nextPage,
          size: PAGE_SIZE,
        });
        if (ticket !== requestSeq.current) return;
        setPage(view);
        setLoadError(false);
      } catch {
        // Fail closed: an unreachable backend shows nothing, never an invented list. The seller has
        // no other copy of what buyers wrote to check a fabrication against.
        if (ticket !== requestSeq.current) return;
        setPage(null);
        setLoadError(true);
      } finally {
        if (ticket === requestSeq.current) setLoading(false);
      }
    },
    [accountId],
  );

  useEffect(() => {
    if (!accountId) return;
    void load(sort, tier, pageIndex);
  }, [accountId, sort, tier, pageIndex, load]);

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
              {/*
                The RECORD's size, not the filtered page's. `page.total` narrows with a tier filter
                while `newCount` and the tier chips stay channel-wide by design, so rendering it here
                put "총 1개" beside "새로 들어온 5개" — two numbers on one line claiming to be the same
                total. Which slice is on screen is the range label's job, under the list.
              */}
              <Chip>총 {recordTotal(page)}개</Chip>
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

      {/*
        **What to look at first, before the list itself.** The counts are of the WHOLE record, not the
        page and not the current filter, so pressing a tier never changes the numbers describing the
        others — otherwise choosing 확인 필요 would zero the chips that lead back out of it.
      */}
      {page ? <TriageSummary page={page} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["attention", "확인 필요순"],
            ["newest", "최신순"],
            ["lowest", "낮은 평점순"],
          ] as const
        ).map(([value, label]) => (
          <Btn
            key={value}
            variant={sort === value ? "solid" : "outline"}
            size="sm"
            aria-pressed={sort === value}
            onClick={() => {
              setSort(value);
              setPageIndex(0);
              setSelectedId(null);
            }}
          >
            {label}
          </Btn>
        ))}
      </div>

      {/*
        The tier filter is separate from the sort and survives a sort change — an operator who
        narrowed to 확인 필요 and then asked for 최신순 wants the newest of those.
      */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="분류 필터">
        <Btn
          variant={tier === null ? "solid" : "outline"}
          size="sm"
          aria-pressed={tier === null}
          onClick={() => {
            setTier(null);
            setPageIndex(0);
            setSelectedId(null);
          }}
        >
          전체 {page ? recordTotal(page) : 0}
        </Btn>
        {TRIAGE_TIERS.map((value) => (
          <Btn
            key={value}
            variant={tier === value ? "solid" : "outline"}
            size="sm"
            aria-pressed={tier === value}
            onClick={() => {
              setTier(value);
              setPageIndex(0);
              setSelectedId(null);
            }}
          >
            {TRIAGE_TIER_LABEL[value]} {page ? tierCount(page, value) : 0}
          </Btn>
        ))}
      </div>

      {loadError ? (
        <Empty
          title="상품평을 불러오지 못했습니다"
          body="연결 상태를 확인한 뒤 다시 시도해 주세요. 불러오지 못한 목록을 임의로 채우지는 않습니다."
          action={
            <Btn size="sm" onClick={() => void load(sort, tier, pageIndex)}>
              다시 시도
            </Btn>
          }
        />
      ) : loading && !page ? (
        <p className="text-muted">불러오는 중…</p>
      ) : page && page.items.length === 0 && tier !== null ? (
        /*
          An empty FILTER is not an empty record. Reusing "아직 수집된 상품평이 없습니다" here would
          tell a seller with 22 상품평 that they have none, because they pressed 확인 필요 and had
          nothing in it — which is good news reported as a loss.
        */
        <Empty
          title={`${TRIAGE_TIER_LABEL[tier]}에 해당하는 상품평이 없습니다`}
          body="다른 분류를 눌러 보시거나 전체를 보세요. 수집된 상품평은 그대로 있습니다."
          action={
            <Btn size="sm" onClick={() => { setTier(null); setPageIndex(0); }}>
              전체 보기
            </Btn>
          }
        />
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
                      <TriageTierChip tier={item.triage.tier} />
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
                    <TriageReason note={item.triage} />
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
                  onClick={() => {
                    setPageIndex((n) => Math.max(0, n - 1));
                    // The chosen review is not on the page being moved to; a 상세 panel still showing it
                    // would sit beside a list where no row is marked current.
                    setSelectedId(null);
                  }}
                >
                  이전
                </Btn>
                <span className="text-sm text-muted">
                  {/* From the response, like the range label beside it — a number taken from local state
                      would advance the moment the button was pressed, over rows still describing the
                      previous page. */}
                  {(page?.page ?? 0) + 1} / {totalPages} 페이지
                </span>
                <Btn
                  size="sm"
                  variant="outline"
                  disabled={pageIndex >= totalPages - 1 || loading}
                  onClick={() => {
                    setPageIndex((n) => n + 1);
                    setSelectedId(null);
                  }}
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
              <ReviewDetail
                detail={detail}
                locate={locate}
                // The run belongs to whichever review was last pressed. Showing its state under a DIFFERENT
                // review would tell the seller SellerOps found the one they are now looking at.
                run={locate.reviewId === detail.id ? locate.view : null}
                running={locate.reviewId === detail.id && locate.starting}
                unavailable={locate.reviewId === detail.id ? locate.unavailable : null}
              />
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

function ReviewDetail({
  detail,
  locate,
  run,
  running,
  unavailable,
}: {
  detail: ChannelReviewDetailView;
  locate: ReviewLocateBinding;
  run: ActionWindowRunView | null;
  running: boolean;
  unavailable: LocateUnavailable | null;
}) {
  const message = locateMessage(run, running);
  // Offered only when the RUNTIME says it is allowed. A recheck the run would refuse is a button that does
  // nothing, and on a screen whose whole job is to be honest about what was found that is the wrong button.
  const canRecheck = run?.allowedCommands.includes("REQUEST_STEP_RECHECK") ?? false;
  const canRaise = run?.allowedCommands.includes("FIND_CURRENT_STEP") ?? false;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TriageTierChip tier={detail.triage.tier} />
        <span className="font-semibold text-ink">{ratingLabel(detail.rating)}</span>
        <span className="text-sm text-muted">{detail.writtenOn ?? "날짜 없음"}</span>
        {detail.isNew ? <Chip tone="accent">새 상품평</Chip> : null}
        {detail.mediaCount > 0 ? <Chip>사진·영상 {detail.mediaCount}</Chip> : null}
      </div>
      <TriageReason note={detail.triage} />
      {detail.triage.tags.length > 0 ? (
        <p className="text-sm leading-relaxed text-muted">{TRIAGE_TAG_DISCLOSURE}</p>
      ) : null}
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

      {/*
        **[쿠팡에서 보기] — the one thing a seller can ask SellerOps to DO with a 상품평.**

        Coupang publishes no per-review link, so this is not a hyperlink and cannot be: the review is found
        again by matching it on the screen the seller has open. That is why the button lives beside a status
        line rather than being a plain anchor — there is a run behind it, and it has things to say.
      */}
      <div className="space-y-2 border-t border-line pt-4">
        <Btn
          size="sm"
          variant="outline"
          disabled={running}
          onClick={() => void locate.locate(detail.id)}
        >
          쿠팡에서 보기
        </Btn>
        <p className="text-sm leading-relaxed text-muted">
          쿠팡 윙의 상품평 목록 화면을 띄워 두시면, 이 상품평이 있는 줄에 테두리를 그려 드립니다. 쿠팡
          화면에서는 아무것도 눌리거나 입력되지 않습니다.
        </p>
        {unavailable ? (
          <p className="text-sm leading-relaxed text-ink">{locateUnavailableText(unavailable)}</p>
        ) : null}
        {message ? (
          <div className="space-y-2">
            <p
              className={`text-sm leading-relaxed ${
                message.tone === "done" ? "text-ink" : message.tone === "failed" ? "text-ink" : "text-muted"
              }`}
              role="status"
            >
              {message.text}
            </p>
            {canRecheck || canRaise ? (
              <div className="flex flex-wrap gap-2">
                {canRecheck ? (
                  <Btn size="sm" variant="outline" onClick={() => locate.send("REQUEST_STEP_RECHECK")}>
                    다시 확인
                  </Btn>
                ) : null}
                {canRaise ? (
                  <Btn size="sm" variant="ghost" onClick={() => locate.send("FIND_CURRENT_STEP")}>
                    쿠팡 창 앞으로
                  </Btn>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The tier, as the one emphasised thing on the row.
 *
 * A `span` rather than a `Chip`: `Chip`'s palette is deliberately two-tone so that no chip can imply
 * a status claim, and widening it to give 확인 필요 its colour would remove that fence for every
 * other surface.
 */
function TriageTierChip({ tier }: { tier: ReviewTriageTier }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${TRIAGE_TIER_CLASS[tier]}`}
    >
      {TRIAGE_TIER_LABEL[tier]}
    </span>
  );
}

/**
 * Why this row is where it is, and what the seller might do about it.
 *
 * The reason is rendered as the backend composed it. `recommendedAction` is null for 참고 and renders
 * as nothing — filling that slot with a reassuring sentence would make every row look equally
 * actionable, which is the opposite of what this screen is for.
 */
function TriageReason({ note }: { note: ReviewTriageNote }) {
  return (
    <span className="mt-1 block text-sm text-muted">
      <span>{note.reason}</span>
      {note.recommendedAction ? (
        <span className="mt-0.5 block break-keep text-ink">{note.recommendedAction}</span>
      ) : null}
    </span>
  );
}

/**
 * How the whole record divides, above the list.
 *
 * Every number here describes the CHANNEL, never the page and never the active filter — so the chips
 * keep pointing at the parts of the record the operator is not currently looking at.
 */
function TriageSummary({ page }: { page: ChannelReviewPageView }) {
  const { needsAttention, repeatedCategories } = page.triageSummary;
  return (
    <div className="rounded-xl border border-line bg-canvas px-4 py-3 text-sm leading-relaxed">
      <p className="text-ink">
        {needsAttention > 0 ? (
          <>
            지금 확인이 필요한 상품평 <b>{needsAttention}건</b>
          </>
        ) : (
          "지금 확인이 필요한 상품평은 없습니다"
        )}
        {page.newCount > 0 ? <span className="text-muted"> · 새로 들어온 {page.newCount}건</span> : null}
      </p>
      {repeatedCategories.length > 0 ? (
        <>
          <p className="mt-1 text-muted">
            반복되는 분류 ·{" "}
            {repeatedCategories.map((c) => `${c.category} ${c.count}건`).join(" · ")}
          </p>
          <p className="mt-1 text-muted">{TRIAGE_TAG_DISCLOSURE}</p>
        </>
      ) : null}
    </div>
  );
}

/**
 * How many reviews the channel holds, whatever the current filter.
 *
 * Summed from the tier counts rather than read from `page.total`, which is the FILTERED total: every
 * review lands in exactly one tier and the summary is always unfiltered, so the sum is the record's
 * size and stays put while the operator narrows.
 */
function recordTotal(page: ChannelReviewPageView): number {
  const { needsAttention, watch, fyi } = page.triageSummary;
  return needsAttention + watch + fyi;
}

/** The summary count for one tier. Kept beside the chips so the label and its number cannot drift. */
function tierCount(page: ChannelReviewPageView, tier: ReviewTriageTier): number {
  if (tier === "NEEDS_ATTENTION") return page.triageSummary.needsAttention;
  if (tier === "WATCH") return page.triageSummary.watch;
  return page.triageSummary.fyi;
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
