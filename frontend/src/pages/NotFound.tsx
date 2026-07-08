import { Link } from "react-router-dom";

// Seller-facing 404. Reached by the router's catch-all (unknown paths are no
// longer silently redirected to the home page). No developer terminology.
export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-3xl font-extrabold text-brand">페이지를 찾을 수 없습니다</p>
      <p className="mt-3 max-w-md text-lg text-muted">
        요청하신 페이지가 없거나 주소가 변경되었을 수 있습니다.
      </p>
      <Link to="/" className="btn-primary mt-6">
        홈으로 돌아가기
      </Link>
    </div>
  );
}
