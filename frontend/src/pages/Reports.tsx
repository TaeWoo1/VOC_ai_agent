import { ComingSoon } from "../components/ComingSoon";

export function Reports() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">리포트</h1>
      <ComingSoon
        title="운영 리포트"
        description="주간 운영 요약과 상세페이지 점검 리포트를 다음 단계에서 제공합니다."
      />
    </div>
  );
}
