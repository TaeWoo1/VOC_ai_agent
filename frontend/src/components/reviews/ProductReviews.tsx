import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Section, ListBox } from "../ui/Section";
import { WorkItem } from "../ui/WorkItem";
import { Empty } from "../ui/Empty";
import { Btn } from "../ui/Btn";
import { ReplyWorkRow } from "./ReplyWorkRow";
import { api } from "../../lib/apiClient";
import { previewText as plainPreview } from "../../lib/plainText";
import { byReplyWorkState } from "../../lib/replyWorkState";
import type { OperatorVocItem, ProductReviewItem, ProductReviewPage } from "../../lib/types";

/** One screenful of the record. The server clamps; the page describes what it got back. */
const PAGE_SIZE = 20;

/**
 * 리뷰, narrowed to ONE product — the surface the 상품 screen's 리뷰 figure opens
 * (Product Operations Continuity v1 §1).
 *
 * <b>Why the account switcher is not here.</b> A product's reviews are not one account's: they are
 * whatever this org holds for that product, and the figure the seller pressed was counted that way.
 * So the scope on this surface is the product, stated in words and clearable, and the channel is a
 * fact on each row rather than a tab above them.
 *
 * <b>Both halves obey the same scope.</b> 내 답변 작업 is narrowed by the SERVER, on the product
 * binding: this surface's rows deliberately carry no product identifier (a fence scans the serialized
 * page for one) and `productName` is a display name two products can share, so the filter cannot be a
 * client-side one. The id the seller arrived with is the id the server is asked about.
 *
 * <b>No reply flow lives here.</b> A row opens `/reviews/reply/{reviewId}`, the one task surface, and
 * this component holds no write at all — no approval, no draft, no dismissal. It is a door, not a
 * second room.
 */
export function ProductReviews({
  productId,
  productName,
  accountIds,
}: {
  productId: string;
  /** The catalogue name, when the caller already read it. Falls back to what the record answers. */
  productName?: string | null;
  /** The review-capable accounts of this org — the reply to-do is per account, the record is not. */
  accountIds: readonly string[];
}) {
  const [page, setPage] = useState(0);
  const [record, setRecord] = useState<ProductReviewPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .getProductReviews(productId, { page, size: PAGE_SIZE })
      .then((view) => {
        if (!live) return;
        setRecord(view);
        setFailed(false);
      })
      .catch(() => {
        if (!live) return;
        setRecord(null);
        setFailed(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [productId, page]);

  useEffect(() => setPage(0), [productId]);

  const name = record?.productName ?? productName ?? null;

  return (
    <div className="space-y-6">
      <ProductScope name={name} />
      <ProductReplyWork productId={productId} accountIds={accountIds} />
      <Section
        title="리뷰 기록"
        count={record ? record.total : null}
        hint={record && record.total > 0 ? shownRange(record) : undefined}
      >
        {failed ? (
          <p className="text-sm text-muted">리뷰를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        ) : loading && record === null ? (
          <p className="text-sm text-muted">불러오는 중…</p>
        ) : record === null || record.items.length === 0 ? (
          <Empty
            title="이 상품의 리뷰가 아직 없습니다"
            body="이 상품에 연결된 리뷰가 수집되면 여기에 모입니다."
          />
        ) : (
          <>
            <ListBox>
              {record.items.map((item, i) => (
                <div key={item.id} className={i > 0 ? "border-t border-line/70" : ""}>
                  <ReviewRecordRow item={item} />
                </div>
              ))}
            </ListBox>
            <Pager page={record.page} size={record.size} total={record.total} onPage={setPage} busy={loading} />
          </>
        )}
      </Section>
    </div>
  );
}

/** "21–40번째" — which slice is on screen, derived from what the RESPONSE said its page and size were. */
export function shownRange(record: ProductReviewPage): string {
  if (record.items.length === 0) return "";
  const first = record.page * record.size + 1;
  return `${first}–${first + record.items.length - 1}번째`;
}

/**
 * What this surface is narrowed to, and the way out.
 *
 * It is a sentence rather than a chip because the seller did not set this filter from here — they
 * arrived through it, and a scope they cannot see is a scope they will read the numbers under.
 */
function ProductScope({ name }: { name: string | null }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-canvas px-4 py-3 text-sm">
      <span className="break-keep text-ink">
        <span className="font-semibold">{name ?? "선택한 상품"}</span>의 리뷰만 보고 있습니다.
      </span>
      <Link
        to="/reviews"
        className="rounded font-semibold text-brand-700 underline-offset-4 hover:text-brand-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
      >
        전체 리뷰 보기
      </Link>
    </p>
  );
}

/**
 * 내 답변 작업, narrowed to this product.
 *
 * <p>Reply work is the seller's own committed work and it is held per account, so this reads each
 * review-capable account once (at most three on a seller-visible org) and keeps only the rows BOUND to
 * this product. An account that fails to load is left out of the list rather than reported as empty
 * work: this component does not know the difference and must not claim one.
 */
function ProductReplyWork({ productId, accountIds }: { productId: string; accountIds: readonly string[] }) {
  const [rows, setRows] = useState<OperatorVocItem[] | null>(null);

  const load = useCallback(async () => {
    const pages = await Promise.all(
      accountIds.map((id) => api.getReplyWork(id, { recentLimit: 1, productId }).catch(() => null)),
    );
    setRows(pages.flatMap((p) => p?.todo ?? []));
  }, [accountIds, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null || rows.length === 0) return null;
  const ordered = byReplyWorkState(rows);
  return (
    <Section title="이 상품의 답변 작업" count={ordered.length}>
      <ListBox>
        {ordered.map((item, i) => (
          <div key={item.actionRef ?? i} className={i > 0 ? "border-t border-line/70" : ""}>
            <ReplyWorkRow item={item} hideProduct />
          </div>
        ))}
      </ListBox>
    </Section>
  );
}

/** One review as a record row: what the buyer wrote, with the channel and the date beside it. */
function ReviewRecordRow({ item }: { item: ProductReviewItem }) {
  const textless = item.preview === null || item.preview.trim().length === 0;
  return (
    <WorkItem
      to={`/reviews/reply/${item.id}`}
      title={
        textless
          ? `별점${item.rating != null ? ` ${item.rating}점` : ""}만 남긴 리뷰`
          : plainPreview(item.preview ?? "")
      }
      dim={textless}
      meta={
        <>
          {item.rating != null ? (
            <span className="mr-1 font-semibold text-ink" aria-label={`별점 ${item.rating}점`}>
              {"★".repeat(item.rating)}
            </span>
          ) : null}
          {item.channelNameKo ?? item.channelCode ?? ""}
        </>
      }
      time={item.writtenOn ?? undefined}
    />
  );
}

/**
 * The way past the first page.
 *
 * A direction is rendered only when it can actually move. A disabled control still occupies the eye
 * and still has to be read before it can be dismissed, and a greyed 이전 on page one tells the seller
 * nothing they did not already know from the counter beside it.
 */
function Pager({
  page,
  size,
  total,
  onPage,
  busy,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (next: number) => void;
  busy: boolean;
}) {
  const last = Math.max(0, Math.ceil(total / size) - 1);
  if (last === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      {page > 0 ? (
        <Btn variant="outline" size="sm" disabled={busy} onClick={() => onPage(page - 1)}>
          이전
        </Btn>
      ) : (
        <span />
      )}
      <span className="text-sm tabular-nums text-muted">
        {page + 1} / {last + 1}
      </span>
      {page < last ? (
        <Btn variant="outline" size="sm" disabled={busy} onClick={() => onPage(page + 1)}>
          다음
        </Btn>
      ) : (
        <span />
      )}
    </div>
  );
}
