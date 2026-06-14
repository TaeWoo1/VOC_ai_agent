import { useMemo, useState } from "react";
import { Section } from "../components/Section";
import { FeedList } from "./Home";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";

type Filter = "ALL" | "INQUIRY" | "REVIEW";

export function Inbox() {
  const { data, loading, error } = useApiData(() => api.getInboxStrict());
  const [filter, setFilter] = useState<Filter>("ALL");
  const [channel, setChannel] = useState<string>("ALL");

  const items = data?.items ?? [];
  const channels = useMemo(
    () => Array.from(new Set(items.map((i) => i.channelNameKo))),
    [items],
  );
  const filtered = items.filter(
    (i) => (filter === "ALL" || i.type === filter) && (channel === "ALL" || i.channelNameKo === channel),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">인박스</h1>
      <p className="text-lg text-muted">문의와 리뷰를 한 곳에서 봅니다.</p>

      {loading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
          인박스 데이터를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
        </div>
      ) : (
      <Section
        title={`통합 피드 (${filtered.length}건)`}
        action={
          <div className="flex gap-2">
            {(["ALL", "INQUIRY", "REVIEW"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-base font-semibold ${
                  filter === f ? "bg-brand text-white" : "bg-canvas text-muted"
                }`}
              >
                {f === "ALL" ? "전체" : f === "INQUIRY" ? "문의" : "리뷰"}
              </button>
            ))}
          </div>
        }
      >
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
        <FeedList items={filtered} />
      </Section>
      )}
    </div>
  );
}
