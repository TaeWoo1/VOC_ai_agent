import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { InboxFilterRail } from "../../components/inbox/InboxFilterRail";
import { InboxList } from "../../components/inbox/InboxList";
import { InboxDetail } from "../../components/inbox/InboxDetail";
import { api } from "../../lib/apiClient";
import { analysisKey, buildAnalysisIndex } from "../../lib/inboxView";
import {
  DEFAULT_FILTERS,
  INQUIRY_STATE_OPTIONS,
  STATE_OPTIONS,
  applyFilters,
  channelOptions,
  resolveSelection,
  sortByPriority,
  type InboxFilters,
  type StateFilter,
} from "../../lib/inboxWorkspace";
import type { FeedItem, ItemAnalysis } from "../../lib/types";

/**
 * 문의 (`/inquiries`, scope="INQUIRY") — inquiries from every connected channel, reply-needed first.
 * The same component still renders the mixed 문의+리뷰 queue with scope="ALL", which no route uses
 * since product assembly A2 (`/inbox` redirects); it is kept only so nothing about the mixed mode has
 * to be re-derived if a screen ever needs it again.
 *
 * On the 문의 surface (A4): the feed is read as `type=INQUIRY` up to the server's ceiling, the header
 * count is the server's own uncapped `unansweredInquiries` — the same number the home shows — and
 * `?state` / `?channel` ARE the filter state both ways (a press rewrites the URL with `replace`; an
 * unknown value is scrubbed). Choosing a row keeps the filters in the URL.
 *
 * Three panes on desktop: filters, list, detail. On narrow screens the detail replaces the list
 * once a row is chosen, so the seller is never scrolled past a pane they cannot see.
 *
 * The inquiry work-item map is what lets the response workflow live here: `InquiryQueueItem`
 * carries both `workItemId` and `inquiryId`, and `FeedItem.id` IS the inquiry id — so the two are
 * joined client-side with no new endpoint. When that read fails the map is empty and the response
 * panel simply does not appear, which is the intended fail-closed behaviour rather than a defect.
 */
export function CustomerInbox({ scope = "ALL" }: { scope?: "ALL" | "INQUIRY" }) {
  const { itemRef } = useParams();
  const inquiriesOnly = scope === "INQUIRY";
  const basePath = inquiriesOnly ? "/inquiries" : "/inbox";
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [analyses, setAnalyses] = useState<ItemAnalysis[]>([]);
  const [workItems, setWorkItems] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const { search } = useLocation();
  const [unanswered, setUnanswered] = useState<number | null>(null);
  const [capped, setCapped] = useState(false);
  const stateOptions = inquiriesOnly ? INQUIRY_STATE_OPTIONS : STATE_OPTIONS;
  /**
   * `?state` and `?channel` are the filter (product assembly A4): the home links here with
   * `?state=NEEDS_REPLY`, and a press on the rail rewrites the URL (`replace`, no history pile-up).
   * Type is fixed by the scope and period stays local — neither is a deep-link seam. Unknown values
   * fall back to the default and are scrubbed once the rows (and so the channel list) have loaded.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const rawState = searchParams.get("state");
  const rawChannel = searchParams.get("channel");
  const state = (stateOptions.find((option) => option.value === rawState)?.value ?? "ALL") as StateFilter;
  const [period, setPeriod] = useState<InboxFilters["period"]>(DEFAULT_FILTERS.period);
  const filters: InboxFilters = useMemo(
    () => ({
      type: inquiriesOnly ? "INQUIRY" : DEFAULT_FILTERS.type,
      state,
      period,
      channel: rawChannel,
    }),
    [inquiriesOnly, state, period, rawChannel],
  );
  const setFilters = useCallback(
    (next: InboxFilters) => {
      setPeriod(next.period);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next.state === "ALL") params.delete("state");
          else params.set("state", next.state);
          if (next.channel) params.set("channel", next.channel);
          else params.delete("channel");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      // 문의: inquiries only, up to the server ceiling; the count beside the list is the server's own.
      const inbox = await api.getInboxStrict(inquiriesOnly ? { type: "INQUIRY", limit: 500 } : {});
      setItems(inbox.items);
      setUnanswered(typeof inbox.unansweredInquiries === "number" ? inbox.unansweredInquiries : null);
      setCapped(inquiriesOnly && inbox.items.length >= 500);
    } catch {
      setItems(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }

    // Enrichment. Both are optional: a failure here degrades detail, never the queue itself.
    try {
      setAnalyses(await api.getItemAnalysisStrict());
    } catch {
      setAnalyses([]);
    }
    try {
      const [open, proposed] = await Promise.all([
        api.getInquiryQueueStrict({ phase: "OPEN", page: 0, size: 100 }),
        api.getInquiryQueueStrict({ phase: "PROPOSED", page: 0, size: 100 }),
      ]);
      const map = new Map<string, string>();
      for (const entry of [...open.content, ...proposed.content]) {
        map.set(entry.inquiryId, entry.workItemId);
      }
      setWorkItems(map);
    } catch {
      setWorkItems(new Map());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Scrub a stale filter once the rows are known: a state this surface does not offer, or a channel
  // no loaded row belongs to, would silently show an empty list under a lit control.
  useEffect(() => {
    if (items === null) return;
    const knownChannels = new Set(channelOptions(items).map((option) => option.value));
    const badState = rawState !== null && !stateOptions.some((option) => option.value === rawState);
    const badChannel = rawChannel !== null && !knownChannels.has(rawChannel);
    if (badState || badChannel) {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (badState) params.delete("state");
          if (badChannel) params.delete("channel");
          return params;
        },
        { replace: true },
      );
    }
  }, [items, rawState, rawChannel, stateOptions, setSearchParams]);

  const analysisIndex = useMemo(() => buildAnalysisIndex(analyses), [analyses]);
  const all = useMemo(
    () => (inquiriesOnly ? (items ?? []).filter((item) => item.type === "INQUIRY") : items ?? []),
    [items, inquiriesOnly],
  );
  const visible = useMemo(
    () => sortByPriority(applyFilters(all, filters), analysisIndex),
    [all, filters, analysisIndex],
  );
  // Resolved against everything loaded, not the filtered view, so a shared link still opens.
  const selection = resolveSelection(all, itemRef);

  return (
    <>
      {inquiriesOnly ? (
        <PageHead
          title="문의"
          description="답변 필요 → 답변함 순으로 봅니다. 답변은 SellerOps가 보내지 않고, 준비한 답을 채널에서 직접 등록합니다."
          meta={
            unanswered !== null ? (
              <>
                <span className="text-sm font-semibold text-ink">
                  지금 답변이 필요한 문의 <span className="tabular-nums">{unanswered}</span>건
                </span>
                {capped ? (
                  <span className="break-keep text-sm text-muted">
                    목록은 최근 500건까지 표시됩니다.
                  </span>
                ) : null}
              </>
            ) : undefined
          }
        />
      ) : (
        <PageHead
          title="고객 인박스"
          description="채널에 들어온 문의와 리뷰를 급한 것부터 확인합니다."
        />
      )}

      {loading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : failed ? (
        <Empty
          title="목록을 불러오지 못했습니다"
          body="연결 상태를 확인한 뒤 다시 시도해 주세요."
          action={<BtnLink to="/connect">채널 연결 확인</BtnLink>}
        />
      ) : all.length === 0 ? (
        <Empty
          title={inquiriesOnly ? "아직 들어온 문의가 없습니다" : "아직 들어온 문의와 리뷰가 없습니다"}
          body="채널을 연결하거나 정기 자료 가져오기로 자료를 넘겨주시면, 채널이 달라도 같은 형태로 모아 보여드립니다."
          action={<BtnLink to="/connect">채널 연결하기</BtnLink>}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)_400px]">
          <div className="lg:sticky lg:top-4 lg:self-start">
            <InboxFilterRail
              items={all}
              filters={filters}
              onChange={setFilters}
              showType={!inquiriesOnly}
              stateOptions={stateOptions}
            />
          </div>

          {/* On narrow screens the chosen row replaces the list, so only one pane competes. */}
          <div
            className={`overflow-hidden rounded-2xl border border-line bg-surface ${
              selection.kind === "FOUND" ? "hidden lg:block" : ""
            }`}
          >
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-muted">
                선택한 조건에 해당하는 항목이 없습니다.
              </p>
            ) : (
              <InboxList
                items={visible}
                analyses={analysisIndex}
                selectedId={selection.kind === "FOUND" ? selection.item.id : null}
                basePath={basePath}
                search={search}
                showType={!inquiriesOnly}
              />
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-4 lg:self-start">
            {selection.kind === "FOUND" ? (
              <InboxDetail
                item={selection.item}
                analysis={analysisIndex.get(
                  analysisKey(selection.item.type, selection.item.id),
                )}
                workItemId={
                  selection.item.type === "INQUIRY"
                    ? workItems.get(selection.item.id) ?? null
                    : null
                }
              />
            ) : selection.kind === "MISSING" ? (
              <div>
                <p className="break-keep font-semibold text-ink">항목을 찾을 수 없습니다</p>
                <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
                  목록에서 다시 선택해 주세요. 자료가 다시 정리되면서 항목이 바뀌었을 수 있습니다.
                </p>
              </div>
            ) : (
              <p className="break-keep text-sm leading-relaxed text-muted">
                왼쪽 목록에서 항목을 고르면 내용과 처리 상태가 여기에 표시됩니다.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
