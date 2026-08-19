import { Link } from "react-router-dom";
import { PRIVACY_PATH, TERMS_PATH } from "../../lib/legal";
import { authLink } from "./AuthCard";

/**
 * The account-consent checkboxes shared by `/signup` and `/onboarding` (docs/service_readiness_v1.md §2-4):
 * 필수 (이용약관 · 개인정보처리방침 — the backend refuses without it) and 선택 (마케팅 수신). The linked pages
 * are placeholders until the documents are confirmed (§7); the structure is what this prepares.
 */
export function ConsentFields({
  idPrefix,
  terms,
  marketing,
  onTerms,
  onMarketing,
}: {
  idPrefix: string;
  terms: boolean;
  marketing: boolean;
  onTerms: (v: boolean) => void;
  onMarketing: (v: boolean) => void;
}) {
  const row = "flex items-start gap-3 text-sm text-ink";
  const box = "mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-700 focus:ring-brand-700";
  return (
    <fieldset className="space-y-2 rounded-xl border border-line bg-canvas px-4 py-3">
      <legend className="sr-only">동의 항목</legend>
      <label className={row} htmlFor={`${idPrefix}-terms`}>
        <input
          id={`${idPrefix}-terms`}
          type="checkbox"
          className={box}
          checked={terms}
          onChange={(e) => onTerms(e.target.checked)}
          required
          aria-required="true"
        />
        <span>
          <span className="font-semibold">(필수)</span>{" "}
          <Link to={TERMS_PATH} className={authLink} target="_blank" rel="noopener noreferrer">
            이용약관
          </Link>
          과{" "}
          <Link to={PRIVACY_PATH} className={authLink} target="_blank" rel="noopener noreferrer">
            개인정보처리방침
          </Link>
          에 동의합니다
        </span>
      </label>
      <label className={row} htmlFor={`${idPrefix}-marketing`}>
        <input
          id={`${idPrefix}-marketing`}
          type="checkbox"
          className={box}
          checked={marketing}
          onChange={(e) => onMarketing(e.target.checked)}
        />
        <span>
          <span className="font-semibold text-muted">(선택)</span> 새 기능·운영 팁 등 마케팅 정보를 이메일로 받습니다
        </span>
      </label>
    </fieldset>
  );
}
