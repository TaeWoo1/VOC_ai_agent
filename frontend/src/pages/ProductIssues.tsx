import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Section } from "../components/Section";
import { StatCard } from "../components/StatCard";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import type { ChipTone } from "../lib/inboxView";
import {
  buildIssueCandidates,
  candidateMatches,
  issuesSummary,
  presentActions,
  presentCategories,
  ACTION_TONE,
  REPEAT_THRESHOLD,
  type ProductIssueCandidate,
} from "../lib/issuesView";

const CHIP_CLASS: Record<ChipTone, string> = {
  good: "bg-good/10 text-good",
  warn: "bg-warn/10 text-warn",
  bad: "bg-bad/10 text-bad",
  neutral: "bg-ink/5 text-ink",
};

/** One product issue-candidate card. Read-only: aggregates the product's analyzed
 *  문의/리뷰 into operating signals — never a final diagnosis, never a raw body. */
function CandidateCard({ c }: { c: ProductIssueCandidate }) {
  const repeated = c.relatedCount >= REPEAT_THRESHOLD;
  return (
    <li className="rounded-xl bg-canvas px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-ink">{c.productName}</span>
        {repeated ? (
          <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs font-semibold text-warn">
            반복·누적
          </span>
        ) : null}
        <span className="text-sm text-muted">관련 {c.relatedCount}건</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {c.dominantCategories.length > 0 ? (
          <span className="text-muted">주이슈: {c.dominantCategories.join(" · ")}</span>
        ) : null}
        <span
          className={`rounded-lg px-2.5 py-1 font-semibold ${CHIP_CLASS[ACTION_TONE[c.topAction] ?? "neutral"]}`}
        >
          {c.topAction}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted">
        {c.negativeCount > 0 ? <span className="text-bad">부정 {c.negativeCount}</span> : null}
        {c.highUrgencyCount > 0 ? <span className="text-bad">긴급 {c.highUrgencyCount}</span> : null}
        {c.unansweredCount > 0 ? <span className="text-warn">미답변 {c.unansweredCount}</span> : null}
      </div>

      {c.exampleSnippets.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-line pt-2 text-sm text-muted">
          {c.exampleSnippets.map((s, i) => (
            <li key={i} className="truncate">
              “{s}”
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3">
        <Link to="/inbox" className="text-sm font-semibold text-brand-700 hover:underline">
          관련 문의·리뷰는 인박스에서 확인 →
        </Link>
      </div>
    </li>
  );
}

export function ProductIssues() {
  // Both reads are essential to this page (unlike the Inbox, where analysis is
  // enrichment): without the join there are no candidates, so if either strict
  // read fails the page fails closed with one explicit error.
  const inbox = useApiData(() => api.getInboxStrict());
  const analysis = useApiData(() => api.getItemAnalysisStrict());

  const [product, setProduct] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const items = useMemo(() => inbox.data?.items ?? [], [inbox.data]);
  const analyses = useMemo(() => analysis.data ?? [], [analysis.data]);
  const candidates = useMemo(
    () => buildIssueCandidates(items, analyses),
    [items, analyses],
  );
  const summary = useMemo(() => issuesSummary(candidates), [candidates]);
  const products = useMemo(() => candidates.map((c) => c.productName), [candidates]);
  const categories = useMemo(() => presentCategories(candidates), [candidates]);
  const actions = useMemo(() => presentActions(candidates), [candidates]);
  const filtered = candidates.filter((c) =>
    candidateMatches(c, { product, category, action }),
  );

  const loading = inbox.loading || analysis.loading;
  const failed = inbox.error || analysis.error;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">상품 이슈</h1>
        <p className="mt-1 text-lg text-muted">
          문의·리뷰에서 반복되는 상품별 운영 이슈 후보를 모아봅니다.
        </p>
        <p className="mt-1 text-sm text-muted">
          운영 신호를 모은 “후보”이며, 최종 진단이 아닙니다. 실제 원인은 내부 확인이 필요합니다.
        </p>
      </div>

      {loading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : failed ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
          상품 이슈 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </div>
      ) : candidates.length === 0 ? (
        <Section title="이슈 후보">
          <div className="rounded-xl border border-dashed border-line py-12 text-center">
            <p className="text-lg font-medium text-ink">아직 모인 이슈 후보가 없습니다.</p>
            <p className="mt-1 text-base text-muted">
              문의·리뷰 자료를 업로드하고 분석하면 상품별 운영 신호가 여기에 모입니다.
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <Link to="/settings/upload" className="btn-primary inline-flex">
                자료 업로드하기 →
              </Link>
              <Link to="/inbox" className="btn-ghost inline-flex">
                인박스 보기
              </Link>
            </div>
          </div>
        </Section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="이슈 후보" value={String(summary.candidateCount)} unit="건" />
            <StatCard
              label="주의 필요 상품"
              value={String(summary.attentionProductCount)}
              unit="개"
              tone={summary.attentionProductCount > 0 ? "bad" : "default"}
            />
            <StatCard
              label="상세페이지 개선 후보"
              value={String(summary.detailPageCandidateCount)}
              unit="건"
              tone={summary.detailPageCandidateCount > 0 ? "warn" : "default"}
            />
            <StatCard label="FAQ 후보" value={String(summary.faqCandidateCount)} unit="건" />
          </div>

          <Section title={`이슈 후보 (${filtered.length}건)`}>
            <div className="mb-4 space-y-2">
              <FilterRow
                label="상품"
                options={products}
                value={product}
                onChange={setProduct}
              />
              <FilterRow
                label="카테고리"
                options={categories}
                value={category}
                onChange={setCategory}
              />
              <FilterRow
                label="추천 작업"
                options={actions}
                value={action}
                onChange={setAction}
              />
            </div>

            {filtered.length === 0 ? (
              <p className="text-base text-muted">해당 조건의 이슈 후보가 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {filtered.map((c) => (
                  <CandidateCard key={c.productName} c={c} />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/** A simple "전체 + chips" filter row; null value = 전체 (no filter on this axis). */
function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-sm text-muted">{label}</span>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`rounded-lg px-3 py-1.5 text-sm ${
          value === null ? "bg-ink text-white" : "bg-canvas text-muted"
        }`}
      >
        전체
      </button>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(value === o ? null : o)}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            value === o ? "bg-ink text-white" : "bg-canvas text-muted"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
