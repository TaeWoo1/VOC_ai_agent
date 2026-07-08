import { Link } from "react-router-dom";

export function Reports() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">리포트</h1>
      <div className="card flex flex-col items-center gap-3 py-16 text-center">
        <span className="text-3xl">📄</span>
        <h2 className="text-xl font-bold">운영 리포트</h2>
        <div className="max-w-md text-lg text-muted">
          <p>리포트는 수집된 리뷰·문의 데이터를 기준으로 생성됩니다.</p>
          <p className="mt-1">현재 연결된 데이터 기준으로 확인 가능한 항목만 표시합니다.</p>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-base">
          <Link to="/settings/channels" className="btn-ghost">
            채널 연결
          </Link>
          <Link to="/settings/upload" className="btn-ghost">
            파일 업로드
          </Link>
        </div>
      </div>
    </div>
  );
}
