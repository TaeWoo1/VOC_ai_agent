import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Section } from "../components/Section";
import { InboxFeed } from "../components/InboxFeed";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import {
  INBOX_TABS,
  analysisKey,
  buildAnalysisIndex,
  matchesTab,
  tabCount,
  workItemMatches,
  workloadSummary,
  type ChipTone,
  type InboxTabKey,
} from "../lib/inboxView";

const STRIP_TONE: Record<ChipTone, string> = {
  good: "bg-good/10 text-good",
  warn: "bg-warn/10 text-warn",
  bad: "bg-bad/10 text-bad",
  neutral: "bg-ink/5 text-ink",
};

export function Inbox() {
  const { data, loading, error } = useApiData(() => api.getInboxStrict());
  const items = data?.items ?? [];
  // Analysis is enrichment, not an essential read: fetched separately so a failure
  // here never blocks the inbox. On error we fall back to an empty index and the
  // cards simply render without an analysis area (fail-soft). Scoped to the loaded
  // feed rows (not the org-wide list), so the inbox payload stays bounded by feed
  // size as the analysis corpus grows. Re-runs when the feed arrives ([data] dep).
  const { data: analysisData } = useApiData(
    () => api.lookupItemAnalysisStrict(items.map((i) => ({ sourceType: i.type, sourceId: i.id }))),
    [data],
  );
  const [tab, setTab] = useState<InboxTabKey>("ALL");
  const [channel, setChannel] = useState<string>("ALL");
  // Optional action/status filter set from the workload strip; composes with the
  // tab + channel filters. null = 전체 작업 (no action filter).
  const [action, setAction] = useState<string | null>(null);
  const analysisIndex = useMemo(
    () => buildAnalysisIndex(analysisData ?? []),
    [analysisData],
  );
  const channels = useMemo(
    () => Array.from(new Set(items.map((i) => i.channelNameKo))),
    [items],
  );
  // Strip counts reflect the whole loaded inbox, so the operator sees total
  // workload regardless of the active tab/channel/action narrowing below.
  const workload = useMemo(
    () => workloadSummary(items, analysisIndex),
    [items, analysisIndex],
  );
  const filtered = items.filter(
    (i) =>
      matchesTab(i, tab) &&
      (channel === "ALL" || i.channelNameKo === channel) &&
      workItemMatches(i, analysisIndex.get(analysisKey(i.type, i.id)), action),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">인박스</h1>
      <p className="text-lg text-muted">문의와 리뷰를 한 곳에서 확인합니다.</p>

      {loading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
          인박스 데이터를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
        </div>
      ) : items.length === 0 ? (
        <Section title="통합 피드">
          <div className="rounded-xl border border-dashed border-line py-12 text-center">
            <p className="text-lg font-medium text-ink">아직 업로드된 문의/리뷰가 없습니다.</p>
            <p className="mt-1 text-base text-muted">
              자료 업로드에서 CSV/XLSX를 올리면 인박스에 표시됩니다.
            </p>
            <Link to="/upload" className="btn-primary mt-4 inline-flex">
              자료 업로드하기 →
            </Link>
          </div>
        </Section>
      ) : (
        <Section title={`통합 피드 (${filtered.length}건)`}>
          {workload.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">처리할 작업</span>
              {workload.map((w) => {
                const active = action === w.label;
                return (
                  <button
                    key={w.label}
                    type="button"
                    onClick={() => setAction(active ? null : w.label)}
                    aria-pressed={active}
                    className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${STRIP_TONE[w.tone]} ${
                      active ? "ring-2 ring-ink/40" : ""
                    }`}
                  >
                    {w.label} {w.count}
                  </button>
                );
              })}
              {action ? (
                <button
                  type="button"
                  onClick={() => setAction(null)}
                  className="rounded-lg px-2.5 py-1 text-sm text-muted hover:bg-ink/5"
                >
                  전체 작업 ✕
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mb-4 flex flex-wrap gap-2">
            {INBOX_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-base font-semibold ${
                  tab === t.key ? "bg-brand text-white" : "bg-canvas text-muted"
                }`}
              >
                {t.label} ({tabCount(items, t.key)})
              </button>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setChannel("ALL")}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                channel === "ALL" ? "bg-ink text-white" : "bg-canvas text-muted"
              }`}
            >
              전체 채널
            </button>
            {channels.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChannel(c)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  channel === c ? "bg-ink text-white" : "bg-canvas text-muted"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <InboxFeed items={filtered} analysisIndex={analysisIndex} />
        </Section>
      )}
    </div>
  );
}
