import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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
  applyFilters,
  resolveSelection,
  sortByPriority,
  type InboxFilters,
} from "../../lib/inboxWorkspace";
import type { FeedItem, ItemAnalysis } from "../../lib/types";

/**
 * 고객 인박스 — 문의 and 리뷰 from every connected channel, in one worst-first queue.
 *
 * Two doors into the same workspace. `/inquiries` renders it with `scope="INQUIRY"` — the 문의
 * destination of the workflow IA (`docs/product_assembly_ia_v1.md` §3): only inquiries, no type
 * filter, links stay under `/inquiries`. `/inbox` remains the mixed queue the home tiles and
 * memory evidence links still point at. Same data, same panes, same response workflow — the scope
 * only decides which rows are in play and where a row's link goes.
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
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const inbox = await api.getInboxStrict();
      setItems(inbox.items);
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
        <PageHead title="문의" description="채널에 들어온 문의를 답변이 필요한 것부터 확인합니다." />
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
