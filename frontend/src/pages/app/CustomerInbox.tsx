import { useCallback, useEffect, useMemo, useState } from "react";
import { analytics } from "../../lib/analytics";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { Disclosure } from "../../components/ui/Disclosure";
import { InboxFilterRail } from "../../components/inbox/InboxFilterRail";
import { InboxList } from "../../components/inbox/InboxList";
import { InboxDetail } from "../../components/inbox/InboxDetail";
import { ProactiveCases } from "../../components/proactive/ProactiveCases";
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
import { useAgentSurface } from "../../lib/agentPanel";

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
  // Growth funnel: 문의 workflow opened (no item ref, no text).
  useEffect(() => {
    if (scope === "INQUIRY") analytics.track("inquiry_opened");
  }, [scope]);
  const inquiriesOnly = scope === "INQUIRY";
  const basePath = inquiriesOnly ? "/inquiries" : "/inbox";
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [analyses, setAnalyses] = useState<ItemAnalysis[]>([]);
  const [workItems, setWorkItems] = useState<Map<string, string>>(new Map());
  /**
   * Inquiry ids the queue reported an actual draft for. A SET of a fact, not a map of a lifecycle
   * phase: 「초안 준비됨」 has to be the draft's own answer (see `InboxList.rowState`).
   */
  const [drafted, setDrafted] = useState<Set<string>>(new Set());
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
  /**
   * THE AGENT IS TOLD WHICH INQUIRY, OR IT IS NOT TOLD 「이 문의」 (Contextual Agent Contract Completion v1).
   *
   * The route carries the inquiry id; the runtime's only exact read for one inquiry takes the WORK
   * ITEM id, which the queue read below joins client-side. Until that join has an entry for this row
   * — while it loads, or for a row the queue no longer holds — the launcher does not promise an
   * investigation of "this inquiry" it cannot scope: it offers the list goal instead. A label that
   * says 「이 문의」 over a run that reads the org queue is the defect this package closes.
   */
  const focusWorkItemId = itemRef ? workItems.get(itemRef) : undefined;
  const focused = focusWorkItemId != null;
  useAgentSurface({
    surface: "inquiries",
    label: focused ? "이 문의" : "문의 목록",
    ...(focused ? { workItemId: focusWorkItemId } : {}),
    ...(rawChannel ? { channelCode: rawChannel } : {}),
  });
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
      const withDraft = new Set<string>();
      for (const entry of [...open.content, ...proposed.content]) {
        map.set(entry.inquiryId, entry.workItemId);
        if (entry.hasDraft) withDraft.add(entry.inquiryId);
      }
      setWorkItems(map);
      setDrafted(withDraft);
    } catch {
      // A read that did not happen proves nothing: no row claims a draft.
      setWorkItems(new Map());
      setDrafted(new Set());
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
  // What the collapsed 필터 control says when it is closed. Only non-default choices are named — a
  // summary reading 「전체 · 전체 기간 · 전체」 would be three words telling the seller nothing.
  const filterSummary = [
    filters.state === "ALL" ? null : stateOptions.find((o) => o.value === filters.state)?.label,
    filters.channel,
    filters.period === DEFAULT_FILTERS.period ? null : "기간 지정",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {inquiriesOnly ? (
        /*
          THE HEADER SHRINKS WHEN A ROW IS OPEN (Executive Readiness Fix v1).

          The detail route was wearing the list route's whole header — title, 「답변이 필요한 문의부터
          봅니다」, and 「지금 답변이 필요한 문의 26건」 — about 200px above a pane whose primary control
          then landed at y=901 with the fold at 900. A reader shown this screen said 「이 화면에는 버튼이
          하나도 없다」 and stopped. Once a row is chosen the seller has already answered 「무엇부터
          볼까」; restating it costs the answer its own screen.
        */
        <PageHead
          title="문의"
          compact={!!itemRef}
          action={
            <AgentLaunch
              context={{
                surface: "inquiries",
                ...(focused ? { workItemId: focusWorkItemId } : {}),
                ...(filters.channel ? { channelCode: filters.channel } : {}),
              }}
              label={focused ? "이 문의에 대해 물어보기" : "문의에 대해 물어보기"}
            />
          }
          meta={
            itemRef ? undefined : unanswered !== null ? (
              <>
                <span className="text-sm text-muted">
                  지금 답변이 필요한 문의 <span className="font-semibold tabular-nums text-ink">{unanswered}</span>건
                </span>
                {capped ? <span className="break-keep text-sm text-muted">목록은 최근 500건까지 표시됩니다.</span> : null}
              </>
            ) : undefined
          }
        />
      ) : (
        <PageHead title="고객 인박스" />
      )}

      {/* 「AI가 먼저 확인한 일」 sits ABOVE the queue, and outside its loading branch on purpose: it is
          the answer to "무엇부터 볼까", and a seller who has to wait for a 500-row feed before seeing it
          has already started scanning the list themselves. It renders nothing when there is nothing.

          It is also not rendered once a row is open (Demo UX Polish v1). Its whole job is to answer
          "무엇부터 볼까"; a seller who followed its own 확인하기 link is already inside the answer, and
          leaving the section above them pushed the inquiry they just chose off the first screen. */}
      {inquiriesOnly && !itemRef ? <div className="mb-5"><ProactiveCases limit={4} /></div> : null}

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
        /*
          TWO SHAPES, NOT ONE (Executive-friendly UX Redesign v1).

          The screen used to be three columns at every moment — 168px of filters, the list, the
          detail — so the work a seller had actually chosen to do lived in the narrowest third while
          eleven filter chips held the position the eye reaches first. Worse, with nothing selected
          that third was a paragraph reading 「왼쪽 목록에서 항목을 고르면…」: forty per cent of the
          screen spent explaining the screen.

          Now the layout answers one question at a time. Nothing chosen → the list is the page.
          A row chosen → the list steps back to a 340px rail and 고객 문의 + AI 답변 take everything
          else, which is the only way §6 「이 둘이 가장 크게」 is true at 1440px.
        */
        <div
          className={
            selection.kind === "NONE"
              ? ""
              : "grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]"
          }
        >
          {/* On narrow screens the chosen row replaces the list, so only one pane competes. */}
          <div className={selection.kind === "FOUND" ? "hidden space-y-3 lg:block" : "space-y-3"}>
            {/* Filters are a tool, not the work. They open when a seller goes looking for them, and
                they stay reachable with a row open — a filter you can only get to by closing the
                thing you are working on is a filter the seller stops using. */}
            <Disclosure label="필터" note={filterSummary ? ` · ${filterSummary}` : undefined}>
              <div className="mt-2 rounded-2xl border border-line bg-surface p-4">
                <InboxFilterRail
                  items={all}
                  filters={filters}
                  onChange={setFilters}
                  showType={!inquiriesOnly}
                  stateOptions={stateOptions}
                />
              </div>
            </Disclosure>

            <div
              className={`overflow-hidden rounded-2xl border border-line bg-surface ${
                selection.kind === "FOUND" ? "lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto" : ""
              }`}
            >
              {visible.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  선택한 조건에 해당하는 항목이 없습니다.
                </p>
              ) : (
                <InboxList
                  items={visible}
                  selectedId={selection.kind === "FOUND" ? selection.item.id : null}
                  basePath={basePath}
                  search={search}
                  showType={!inquiriesOnly}
                  drafted={drafted}
                  dense={selection.kind === "FOUND"}
                />
              )}
            </div>
          </div>

          {selection.kind === "NONE" ? null : (
            /*
              Its own scroller, so the pane's primary control can be pinned to the bottom of it
              rather than to the bottom of a document whose height depends on how much the customer
              wrote. A short question and a long one now behave the same way.
            */
            <div className="rounded-2xl border border-line bg-surface p-5 lg:max-h-[calc(100vh-7.5rem)] lg:overflow-y-auto">
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
              ) : (
                <div>
                  <p className="break-keep font-semibold text-ink">항목을 찾을 수 없습니다</p>
                  <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
                    목록에서 다시 선택해 주세요. 자료가 다시 정리되면서 항목이 바뀌었을 수 있습니다.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
