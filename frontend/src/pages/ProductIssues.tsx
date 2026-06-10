import { Section } from "../components/Section";

// Phase 1 placeholder. Real repeated-issue discovery arrives via the future
// bridge to the Python review-ops engine (analysis/ReviewAnalysisPort).
const SAMPLE = [
  {
    title: "접착력 부족",
    summary: "부착 후 시간이 지나면 떨어진다는 의견이 반복됩니다. (예시 데이터)",
    priority: "🔴 이번 주 반영 검토",
  },
  {
    title: "절단 시 깨짐",
    summary: "재단·시공 중 깨짐을 언급하는 의견이 보입니다. (예시 데이터)",
    priority: "🟡 내부 확인",
  },
];

export function ProductIssues() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">상품 이슈</h1>
      <p className="text-lg text-muted">
        리뷰에서 반복되는 점검 후보를 모읍니다. 실제 분석 연결은 다음 단계에서 제공됩니다.
      </p>
      <Section title="반복 이슈 (예시)">
        <ul className="space-y-3">
          {SAMPLE.map((it) => (
            <li key={it.title} className="rounded-xl bg-canvas px-4 py-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">{it.title}</span>
                <span className="text-base">{it.priority}</span>
              </div>
              <p className="mt-1 text-base text-muted">{it.summary}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
