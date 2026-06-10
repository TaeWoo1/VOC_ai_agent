import { ComingSoon } from "../components/ComingSoon";

export function AlertSettings() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">알림 설정</h1>
      <ComingSoon
        title="알림 설정"
        description="미답변 문의·부정 리뷰·긴급 이슈 알림을 다음 단계에서 설정할 수 있습니다."
      />
    </div>
  );
}
