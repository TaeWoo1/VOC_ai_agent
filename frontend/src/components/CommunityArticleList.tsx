import { useState } from "react";
import { Section } from "./Section";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import type { CommunityArticleView } from "../lib/types";

// Metadata-only drill-down of collected community articles, REVIEW / INQUIRY tabs.
// The API never returns article title/content/identifiers, so this list shows only
// type, rating, reply state, and dates — no customer text or PII is rendered.

const PAGE_SIZE = 10;

const TABS: Array<{ type: string; label: string }> = [
  { type: "REVIEW", label: "리뷰" },
  { type: "INQUIRY", label: "문의" },
];

const REPLY_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "미답변", cls: "bg-warn/10 text-warn" },
  IN_PROGRESS: { text: "처리 중", cls: "bg-brand/10 text-brand-700" },
  ANSWERED: { text: "답변 완료", cls: "bg-good/10 text-good" },
  UNKNOWN: { text: "상태 미상", cls: "bg-canvas text-muted" },
};

function ReplyChip({ status }: { status: string }) {
  const r = REPLY_LABEL[status] ?? REPLY_LABEL.UNKNOWN;
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold ${r.cls}`}>
      {r.text}
    </span>
  );
}

function ArticleRow({ row }: { row: CommunityArticleView }) {
  return (
    <li className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <ReplyChip status={row.replyStatus} />
        {row.rating != null ? (
          <span className="text-sm font-semibold text-ink">{"★".repeat(row.rating)}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-4 text-sm text-muted">
        <span>작성 {row.sourceCreatedDate ?? "날짜 미상"}</span>
        <span>수집 {row.collectedDate ?? "-"}</span>
      </div>
    </li>
  );
}

export function CommunityArticleList({
  accountId,
  refreshKey = 0,
}: {
  accountId: string;
  refreshKey?: number;
}) {
  const [type, setType] = useState("REVIEW");
  const [page, setPage] = useState(0);

  const { data, loading, error } = useApiData(
    () => api.getAccountArticles(accountId, { type, page, size: PAGE_SIZE }),
    [accountId, type, page, refreshKey],
  );

  function switchType(next: string) {
    setType(next);
    setPage(0);
  }

  const hasNext = data ? (data.page + 1) * data.size < data.total : false;

  return (
    <Section title="수집된 리뷰·문의">
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => switchType(t.type)}
            className={`rounded-xl px-4 py-2 text-base font-semibold ${
              type === t.type ? "bg-brand/10 text-brand-700" : "bg-canvas text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-base text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          수집된 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : data.items.length === 0 ? (
        <p className="text-base text-muted">아직 수집된 데이터가 없습니다.</p>
      ) : (
        <>
          <p className="mb-1 text-sm text-muted">총 {data.total.toLocaleString("ko-KR")}건</p>
          <ul className="divide-y divide-line">
            {data.items.map((row, i) => (
              <ArticleRow key={`${row.type}-${data.page}-${i}`} row={row} />
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
            >
              이전
            </button>
            <span className="text-sm text-muted">{page + 1} 페이지</span>
            <button
              type="button"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
