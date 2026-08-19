import { Link } from "react-router-dom";
import { PRODUCT_PATH } from "../lib/public/publicCta";
import { PRIVACY_PATH, TERMS_PATH, TERMS_VERSION } from "../lib/legal";

/**
 * `/legal/terms` and `/legal/privacy` — PLACEHOLDERS (docs/service_readiness_v1.md §2-4, §7). No legal wording
 * is generated here: the page names the document, says plainly that it is not yet confirmed, and gives the
 * version marker the consent record carries. Replaced by the confirmed documents before public launch.
 */
export function LegalPlaceholder({ kind }: { kind: "terms" | "privacy" }) {
  const title = kind === "terms" ? "이용약관" : "개인정보처리방침";
  const other = kind === "terms" ? { to: PRIVACY_PATH, label: "개인정보처리방침" } : { to: TERMS_PATH, label: "이용약관" };
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 md:px-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">SellerOps</p>
      <h1 className="mt-2 text-3xl font-bold text-ink">{title}</h1>
      <div className="mt-6 rounded-xl border border-line bg-canvas px-5 py-4" role="status">
        <p className="text-base font-semibold text-ink">이 문서는 아직 확정되지 않았습니다</p>
        <p className="mt-1 break-keep text-sm leading-relaxed text-muted">
          정식 {title}은 외부 공개 전에 별도로 확정되어 이 자리에 게시됩니다. 지금 가입 시 기록되는 동의는 문서 버전{" "}
          <code className="rounded bg-surface px-1 py-0.5 text-xs">{TERMS_VERSION}</code>(초안 표시)로 저장되며, 문서 확정 시
          안내와 함께 갱신됩니다.
        </p>
      </div>
      <p className="mt-6 text-sm text-muted">
        문의: 서비스 운영자에게 연락해 주세요. ·{" "}
        <Link to={other.to} className="font-medium text-brand-700 hover:text-ink">
          {other.label}
        </Link>{" "}
        ·{" "}
        <Link to={PRODUCT_PATH} className="font-medium text-brand-700 hover:text-ink">
          제품 소개
        </Link>
      </p>
    </div>
  );
}
