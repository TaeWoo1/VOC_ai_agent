import { useState } from "react";
import { Section } from "../components/Section";

// Phase 1 placeholder — no real retrieval. Wires to the Python review-ops Q&A
// engine in a later phase (analysis/ReviewAnalysisPort.searchReviews).
export function AiSearch() {
  const [query, setQuery] = useState("");
  const [answered, setAnswered] = useState(false);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">AI 검색</h1>
      <p className="text-lg text-muted">리뷰 내용을 자연어로 물어볼 수 있습니다. (다음 단계 연결 예정)</p>

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
            AI 검색은 다음 단계에서 연결될 예정입니다. 지금은 예시 화면입니다.
          </div>
        ) : null}
      </Section>
    </div>
  );
}
