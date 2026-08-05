import { Link } from "react-router-dom";
import { PRODUCT_PATH } from "../../lib/public/publicCta";

/**
 * Public-surface footer. Minimal by intent — business/legal detail is added when the
 * corresponding facts exist, not as placeholder rows.
 */
export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 md:flex-row md:items-center md:justify-between md:px-8">
        <div>
          <p className="text-base font-bold text-ink">SellerOps</p>
          <p className="mt-1 text-sm text-muted">
            온라인 판매자와 중소기업을 위한 AI 고객운영 도구
          </p>
        </div>
        <nav aria-label="푸터" className="flex items-center gap-4 text-sm text-muted">
          <Link
            to={PRODUCT_PATH}
            className="rounded transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            제품 소개
          </Link>
          <Link
            to="/login"
            className="rounded transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            로그인
          </Link>
        </nav>
      </div>
    </footer>
  );
}
