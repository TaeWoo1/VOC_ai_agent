import { useState } from "react";
import { Link } from "react-router-dom";
import { Section } from "../components/Section";

// Phase 1 workspace — no real retrieval yet. Wires to the Python review-ops Q&A
// engine later (analysis/ReviewAnalysisPort.searchReviews). The UI runs only on
// connected review/inquiry data and never fabricates an answer.
export function AiSearch() {
  const [query, setQuery] = useState("");
  const [answered, setAnswered] = useState(false);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">AI 검색</h1>
      <p className="text-lg text-muted">
        연결된 리뷰·문의 데이터 안에서 자연어로 검색할 수 있습니다.
      </p>

      <Section title="리뷰에게 물어보기">
        <div className="flex gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 포장이나 배송 관련 부정적인 이슈만 모아줘"
            className="flex-1 rounded-xl border border-line px-4 py-3 text-lg focus:border-brand focus:outline-none"
          />
          <button type="button" className="btn-primary" onClick={() => setAnswered(true)}>
            검색
          </button>
        </div>
        {answered ? (
          <div className="mt-4 rounded-xl bg-canvas px-4 py-4 text-lg text-muted">
            <p>현재 연결된 리뷰·문의 데이터가 없습니다.</p>
            <p className="mt-1">수집된 데이터가 쌓이면 이 화면에서 확인할 수 있습니다.</p>
            <div className="mt-3 flex flex-wrap gap-3 text-base">
              <Link to="/channels" className="btn-ghost">
                채널 연결
              </Link>
              <Link to="/upload" className="btn-ghost">
                파일 업로드
              </Link>
            </div>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
