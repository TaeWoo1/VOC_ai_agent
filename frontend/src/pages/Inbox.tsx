import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Section } from "../components/Section";
import { InboxFeed } from "../components/InboxFeed";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { INBOX_TABS, matchesTab, tabCount, type InboxTabKey } from "../lib/inboxView";

export function Inbox() {
  const { data, loading, error } = useApiData(() => api.getInboxStrict());
  const [tab, setTab] = useState<InboxTabKey>("ALL");
  const [channel, setChannel] = useState<string>("ALL");

  const items = data?.items ?? [];
  const channels = useMemo(
    () => Array.from(new Set(items.map((i) => i.channelNameKo))),
    [items],
  );
  const filtered = items.filter(
    (i) => matchesTab(i, tab) && (channel === "ALL" || i.channelNameKo === channel),
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

          <InboxFeed items={filtered} />
        </Section>
      )}
    </div>
  );
}
