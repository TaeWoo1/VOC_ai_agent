import { useCallback, useEffect, useMemo, useState } from "react";
import { analytics } from "../../lib/analytics";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Section } from "../../components/ui/Section";
import { Empty } from "../../components/ui/Empty";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { Status } from "../../components/ui/Status";
import { WorkItem } from "../../components/ui/WorkItem";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { InboxDetail } from "../../components/inbox/InboxDetail";
import { Facts } from "../../components/ui/ObjectRow";
import { MasterDetail, useWideLayout } from "../../components/workspace/MasterDetail";
import { CaseLayout } from "../../components/workspace/CaseLayout";
import { api } from "../../lib/apiClient";
import { analysisKey, buildAnalysisIndex } from "../../lib/inboxView";
import { previewText } from "../../lib/plainText";
import { relativeTime } from "../../lib/format";
import { productChannelLabel } from "../../lib/productRows";
import {
  RECORD_STATUS_OPTIONS,
  asFeedItem,
  recordRowState,
} from "../../lib/inquiryWorkspace";
import type { InquiryQueueItem, InquiryRowItem, ItemAnalysis } from "../../lib/types";
import { useAgentSurface } from "../../lib/agentPanel";

/**
 * 문의 — 지금 처리할 일, then 전체 문의 (Inquiry Operations Workspace v1).
 *
 * <b>The shape, and why it is two reads.</b> This screen used to make one: the inbox feed, `limit=500`,
 * every row rendered in a single column. On the demo org that was 94 rows and 7,100px, an answered
 * inquiry from last week carrying the same weight as the oldest unanswered one, with no way to search.
 * A seller with three thousand inquiries would have been handed three thousand rows.
 *
 * So the two questions are asked separately, of the two reads the product already had:
 *
 * <ul>
 *   <li><b>지금 처리할 일</b> — the WORK QUEUE (`GET /api/inquiries?phase=…`). Its membership is
 *       `InquiryWorkItemPhase.AWAITING_SELLER` = {OPEN, PROPOSED}, declared once in the backend as
 *       「the phases where the work is still waiting for the SELLER to decide something」 and read by
 *       every recommendation surface. Nothing about inclusion is decided on this screen.</li>
 *   <li><b>전체 문의</b> — the RECORD (`GET /api/inquiries/rows`), filtered server-side by 검색 · 채널 ·
 *       답변 상태 · 상품, bounded to one page, with the whole set's count beside it.</li>
 * </ul>
 *
 * <b>An inquiry may be in both.</b> In the queue it is work; in the record it is a record. 리뷰 has
 * read this way since Review Approval Path v1 — its 목록 holds all 4,455 rows including the four in
 * 내 답변 작업.
 *
 * <b>Two shapes, kept.</b> Nothing chosen → the two sections are the page. A row chosen → they step
 * back to a 340px rail and 고객 문의 + AI 답변 take the rest, which is the layout Executive-friendly UX
 * Redesign v1 measured and this package had no reason to disturb. The detail is the same
 * `InboxDetail`, on the same `/inquiries/{inquiryId}` route a chat artifact links to.
 *
 * <b>A deep link always opens.</b> When the named inquiry is not on the page the filters happen to be
 * showing, it is fetched by id through the SAME read — one indexed lookup, where the screen used to
 * keep 500 rows loaded so that any link would resolve.
 *
 * <b>The mixed 문의+리뷰 mode is gone.</b> It was a `scope` prop no route had passed since product
 * assembly A2 (`/inbox` redirects here), kept in case a screen wanted it back. Two reads later it was
 * a branch nothing could reach, describing a feed this screen no longer makes; a mode with no caller
 * is not an option, it is unexercised code claiming to be one.
 */
export function CustomerInbox() {
  const { itemRef } = useParams();
  // Growth funnel: 문의 workflow opened (no item ref, no text).
  useEffect(() => {
    analytics.track("inquiry_opened");
  }, []);

  const [queue, setQueue] = useState<InquiryQueueItem[] | null>(null);
  const [record, setRecord] = useState<InquiryRowItem[] | null>(null);
  const [recordTotal, setRecordTotal] = useState<number | null>(null);
  // How many pages of the record have been asked for. Rows accumulate rather than replace, so 더 보기
  // lengthens the list a seller is reading instead of moving them to a page they have to navigate back
  // from. Reset by any change to the filters, because a page number means nothing across two questions.
  const [recordPages, setRecordPages] = useState(1);
  const [linked, setLinked] = useState<InquiryRowItem | null>(null);
  const [analyses, setAnalyses] = useState<ItemAnalysis[]>([]);
  /** The server's own total for the queue read — the page below it may be smaller. */
  const [queueTotal, setQueueTotal] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  /**
   * The record's filters ARE the URL, so a narrowed list is a link a seller can keep and a doorway
   * from another screen is an ordinary navigation. `productId` is the one a product opens.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "ALL";
  const channel = searchParams.get("channel");
  const productId = searchParams.get("productId");
  const q = searchParams.get("q") ?? "";
  const [draftQuery, setDraftQuery] = useState(q);
  useEffect(() => setDraftQuery(q), [q]);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value == null || value === "" || value === "ALL") next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // The queue: read once, independent of the record's filters. Narrowing a search must not change
  // what the seller owes.
  const loadQueue = useCallback(async () => {
    try {
      // ONE read of the phases this product declared as 「waiting for the seller」
      // (`InquiryWorkItemPhase.AWAITING_SELLER`, now the queue endpoint's own default). This used to be
      // two reads whose pages were concatenated here, which put the definition of 「지금 처리할 일」 in
      // this file — and 홈, asking the same endpoint without naming phases, got half of it and printed
      // 11 while this heading printed 21. The concatenation also capped each phase at 100 separately,
      // so a large backlog would have been drawn as its own total.
      const page = await api.getInquiryQueueStrict({ page: 0, size: 100 });
      setQueue(page.content);
      setQueueTotal(page.totalElements);
    } catch {
      // A read that did not happen is not an empty queue; the section says so rather than showing none.
      setQueue(null);
      setQueueTotal(null);
    }
    try {
      setAnalyses(await api.getItemAnalysisStrict());
    } catch {
      setAnalyses([]);
    }
  }, []);

  const loadRecord = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      // Every requested page, through the same predicate — the read echoes its own page, so the rows on
      // screen and the total beside them are always describing the same question.
      const pages = await Promise.all(
        Array.from({ length: recordPages }, (_, page) =>
          api.getInquiryRowsStrict({
            limit: PAGE_SIZE,
            page,
            order: "NEWEST",
            ...(status !== "ALL" ? { status } : {}),
            ...(channel ? { channel } : {}),
            ...(productId ? { productId } : {}),
            ...(q.trim() ? { q: q.trim() } : {}),
          }),
        ),
      );
      setRecord(pages.flatMap((page) => page.items));
      setRecordTotal(pages[pages.length - 1].totalCount);
    } catch {
      setRecord(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [status, channel, productId, q, recordPages]);

  // A new question starts at its first page. Without this, changing a filter would ask for pages 2..n
  // of a list that no longer exists.
  useEffect(() => setRecordPages(1), [status, channel, productId, q]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);
  useEffect(() => {
    void loadRecord();
  }, [loadRecord]);

  // A link naming a row the current page does not hold. One exact read through the same predicate.
  useEffect(() => {
    if (!itemRef) {
      setLinked(null);
      return;
    }
    const onPage = (record ?? []).some((row) => row.inquiryId === itemRef);
    if (onPage) {
      setLinked(null);
      return;
    }
    let active = true;
    void api
      .getInquiryRowsStrict({ inquiryId: itemRef, limit: 1 })
      .then((page) => active && setLinked(page.items[0] ?? null))
      .catch(() => active && setLinked(null));
    return () => {
      active = false;
    };
  }, [itemRef, record]);

  const analysisIndex = useMemo(() => buildAnalysisIndex(analyses), [analyses]);
  const wide = useWideLayout();

  /** The rows a selection may resolve against: the record page, the queue, and the linked row. */
  const selected = useMemo(() => {
    if (!itemRef) return null;
    const fromRecord = (record ?? []).find((row) => row.inquiryId === itemRef);
    if (fromRecord) return asFeedItem(fromRecord);
    if (linked && linked.inquiryId === itemRef) return asFeedItem(linked);
    return null;
  }, [itemRef, record, linked]);

  const workItemId = useMemo(() => {
    if (!itemRef) return null;
    const fromQueue = (queue ?? []).find((row) => row.inquiryId === itemRef);
    if (fromQueue) return fromQueue.workItemId;
    const fromRecord = (record ?? []).find((row) => row.inquiryId === itemRef);
    return fromRecord?.workItemId ?? linked?.workItemId ?? null;
  }, [itemRef, queue, record, linked]);

  const focused = workItemId != null;
  useAgentSurface({
    surface: "inquiries",
    label: focused ? "이 문의" : "문의 목록",
    ...(focused ? { workItemId } : {}),
    ...(channel ? { channelCode: channel } : {}),
    ...(productId ? { productId } : {}),
  });

  /** The product the record is scoped to, named from a row rather than looked up separately. */
  const scopedProductName =
    productId != null
      ? (record ?? []).find((row) => row.productId === productId)?.productName ?? null
      : null;

  /**
   * The work, scoped the way the page is scoped.
   *
   * <b>Measured, not assumed.</b> Unscoped, the queue is the seller's whole workload and that is
   * exactly right. But a seller who pressed 「미답변 문의 1」 on a product arrives at a page whose first
   * section is 21 items about other products, with the one row they asked for 1,900px below it — the
   * doorway would have delivered them to the wrong thing correctly. When the page is about one
   * product, so is the work on it.
   *
   * A filter over rows already read, never a second query: the queue is bounded and every row carries
   * its `productId`.
   */
  const queueRows = useMemo(
    () => (productId ? (queue ?? []).filter((row) => row.productId === productId) : queue ?? []),
    [queue, productId],
  );
  // What the pane shows: the chosen inquiry, or — on a wide screen with nothing chosen — the first row of the work
  // the seller owes, which is the row this screen itself says to look at first.
  const defaultRow = wide && !itemRef ? (record ?? [])[0] ?? null : null;
  const shownRef = itemRef ?? defaultRow?.inquiryId;
  const shownItem = selected ?? (defaultRow ? asFeedItem(defaultRow) : null);
  const shownWorkItemId = itemRef
    ? workItemId
    : defaultRow
      ? (queue ?? []).find((row) => row.inquiryId === defaultRow.inquiryId)?.workItemId ?? defaultRow.workItemId
      : null;

  const channels = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of record ?? []) {
      if (row.channelCode) seen.set(row.channelCode, row.channelNameKo ?? productChannelLabel(row.channelCode));
    }
    return [...seen.entries()];
  }, [record]);

  const head = (
    <PageHead
      title="문의"
      compact={!!itemRef}
      action={
        <AgentLaunch
          context={{
            surface: "inquiries",
            ...(focused ? { workItemId } : {}),
            ...(channel ? { channelCode: channel } : {}),
          }}
          label={focused ? "이 문의에 대해 물어보기" : "문의에 대해 물어보기"}
        />
      }
      /* No meta: the section below is titled 「지금 처리할 일」 and carries the same count, and the two
         sat 80px apart saying the same words twice. The section owns it, because it owns the rows. */
    />
  );

  const lists = (
    <>
      {/* The work is 확인할 일's (UI/UX v2 Phase 3): this screen is where inquiries are looked up. It used to open
          with its own 「지금 처리할 일」 list — the same inquiries 확인할 일 already lists, in a second layout. */}
      {queue === null ? (
        <p className="text-sm text-warn" role="status">
          처리할 문의 수를 불러오지 못했습니다. 아래 전체 문의는 그대로 보실 수 있습니다.
        </p>
      ) : queueRows.length > 0 ? (
        <p className="text-sm">
          <Link to="/customer-operations/cases" className="font-semibold text-brand-700 hover:underline">
            확인할 일에 문의 {(productId ? queueRows.length : queueTotal ?? queueRows.length).toLocaleString("ko-KR")}건 →
          </Link>
        </p>
      ) : null}

      {/* ── 전체 문의 ────────────────────────────────────────────────── */}
      <Section title="전체 문의" count={recordTotal ?? undefined} hint="답변한 문의까지 모두 여기 있습니다. 찾을 때 쓰세요.">
        {productId ? (
          <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="record-product-scope">
            <Status tone="info">{scopedProductName ?? "이 상품"}의 문의만 보고 있습니다</Status>
            <button
              type="button"
              onClick={() => setParam("productId", null)}
              className="rounded-md text-sm font-medium text-muted underline underline-offset-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            >
              전체 문의 보기
            </button>
          </div>
        ) : null}

        <form
          className="mb-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", draftQuery.trim());
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">문의 내용 검색</span>
            <input
              type="search"
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              placeholder="고객이 쓴 말로 찾기 (예: 세금계산서)"
              className="w-full min-w-[12rem] rounded-lg border border-line bg-surface px-3 py-1.5 text-base focus:border-brand-700 focus:outline-none"
            />
          </label>
          <select
            aria-label="채널"
            value={channel ?? ""}
            onChange={(e) => setParam("channel", e.target.value || null)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
          >
            <option value="">모든 채널</option>
            {channels.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <select
            aria-label="답변 상태"
            value={status}
            onChange={(e) => setParam("status", e.target.value)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
          >
            {RECORD_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </form>

        {loading ? (
          <p className="px-1 py-6 text-sm text-muted">불러오는 중…</p>
        ) : failed ? (
          <Empty
            title="문의를 불러오지 못했습니다"
            body="연결 상태를 확인한 뒤 다시 시도해 주세요."
            action={<BtnLink to="/connect">채널 연결 확인</BtnLink>}
          />
        ) : (record ?? []).length === 0 ? (
          <Empty
            title={hasNarrowing(q, channel, status, productId) ? "찾는 문의가 없습니다" : "아직 들어온 문의가 없습니다"}
            body={
              hasNarrowing(q, channel, status, productId)
                ? "다른 말로 찾거나 조건을 넓혀 보세요."
                : "채널을 연결하거나 정기 자료 가져오기로 자료를 넘겨주시면, 채널이 달라도 같은 형태로 모아 보여드립니다."
            }
            action={hasNarrowing(q, channel, status, productId) ? undefined : <BtnLink to="/connect">채널 연결하기</BtnLink>}
          />
        ) : (
          <>
            <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line bg-surface">
              {(record ?? []).map((row) => {
                const state = recordRowState(row);
                return (
                  <li key={row.inquiryId}>
                    <WorkItem
                      to={`/inquiries/${row.inquiryId}`}
                      selected={row.inquiryId === shownRef}
                      ariaCurrent={row.inquiryId === shownRef ? "true" : undefined}
                      // The record is a place to look things up: a settled row is quieter than the work above.
                      dim={row.status === "ANSWERED"}
                      state={state.text}
                      tone={state.tone}
                      title={previewText(row.snippet) || row.title || "문의"}
                      meta={
                        <>
                          {row.channelNameKo}
                          {row.productName ? ` · ${row.productName}` : ""}
                        </>
                      }
                      time={relativeTime(row.receivedAt)}
                    />
                  </li>
                );
              })}
            </ul>
            {/* Said only when there IS more — a page that holds everything says nothing. */}
            {recordTotal != null && recordTotal > (record ?? []).length ? (
              <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
                <Btn variant="outline" size="sm" disabled={loading} onClick={() => setRecordPages((n) => n + 1)}>
                  {loading ? "불러오는 중…" : "더 보기"}
                </Btn>
                <span className="text-sm tabular-nums text-muted">
                  {(record ?? []).length} / {recordTotal}건
                </span>
              </div>
            ) : null}
          </>
        )}
      </Section>
    </>
  );

  const detail = shownItem ? (
    <InquiryCasePane
      item={shownItem}
      analysis={analysisIndex.get(analysisKey("INQUIRY", shownItem.id))}
      workItemId={shownWorkItemId}
    />
  ) : itemRef && !loading ? (
    <div>
      <p className="break-keep font-semibold text-ink">문의를 찾을 수 없습니다</p>
      <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
        목록에서 다시 선택해 주세요. 자료가 다시 정리되면서 항목이 바뀌었을 수 있습니다.
      </p>
    </div>
  ) : itemRef ? (
    <p className="text-sm text-muted">불러오는 중…</p>
  ) : null;

  /*
    Master-detail (UI/UX v2 Phase 2). The list and the chosen inquiry each own their scroll, so reading a long
    answer never drags the list — the page used to be one 7,071px scroll whose height was the list's. On a wide
    screen the first 지금 처리할 일 row is open when nothing is chosen; on a narrow one the chosen inquiry replaces
    the list, with the way back above it, exactly as before.
  */
  const list =
    !wide && itemRef ? (
      <>
        {head}
        <Link to="/inquiries" className="text-sm font-semibold text-muted hover:text-ink hover:underline">
          ← 문의 목록
        </Link>
        {detail}
      </>
    ) : (
      <>
        {head}
        {lists}
      </>
    );

  return <MasterDetail wide={wide} list={list} detailLabel="문의 상세" detail={detail} />;
}

/**
 * One inquiry in the pane, in {@link CaseLayout}'s reading order: where and when, then the customer's words and the
 * answer (the response panel owns both, so the layout draws no second copy of the question), then the automatic
 * classification, folded.
 */
function InquiryCasePane({
  item,
  analysis,
  workItemId,
}: {
  item: ReturnType<typeof asFeedItem>;
  analysis: ItemAnalysis | undefined;
  workItemId: string | null;
}) {
  return (
    <CaseLayout
      key={item.id}
      variant="pane"
      label="선택한 문의"
      decisionLabel="답변"
      // When the response panel mounts it prints the question, the channel, the product and the time as its own
      // first block — so the layout draws none of them a second time.
      meta={
        workItemId === null ? (
          <Facts>
            <span>{item.channelNameKo}</span>
            {item.productName ? <span className="break-keep">{item.productName}</span> : null}
            <span>{relativeTime(item.receivedAt)}</span>
          </Facts>
        ) : undefined
      }
      title={previewText(item.snippet) || "문의"}
      titleHidden={workItemId !== null}
      // No 「전체 화면으로」: this route IS the inquiry's own screen, so the link would point at the page it is on.
      decision={<InboxDetail item={item} analysis={analysis} workItemId={workItemId} />}
    />
  );
}


/** One page of the record. The seller narrows rather than scrolls; the count says what is behind it. */
const PAGE_SIZE = 50;

/** Whether the seller asked for something, so an empty result is 「찾는 게 없다」 and not 「아무것도 없다」. */
function hasNarrowing(q: string, channel: string | null, status: string, productId: string | null): boolean {
  return q.trim() !== "" || channel != null || status !== "ALL" || productId != null;
}

