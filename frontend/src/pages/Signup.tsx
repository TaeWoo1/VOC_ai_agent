import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { signupFailure } from "../lib/signupError";
import { PRODUCT_PATH } from "../lib/public/publicCta";
import { analytics } from "../lib/analytics";
import { AuthCard, authField, authLabel, authLink, authPrimaryButton } from "../components/auth/AuthCard";
import { SocialSignInButtons } from "../components/auth/SocialSignInButtons";
import { ConsentFields } from "../components/auth/ConsentFields";

/** Where a brand-new org lands: nothing is connected yet, so the first thing to do IS 채널 연결. */
export const FIRST_RUN_PATH = "/connect";

/**
 * 회원가입 (`/signup`) — the first screen of the Self-Pilot first-run journey
 * (가입 → 채널 연결 → 첫 수집 → 홈). Uses the existing `POST /api/auth/signup`; the answer is a session
 * (token + user), so a successful sign-up goes straight to 채널 연결 with no second login form.
 *
 * Google / NAVER sign-up (when the deployment offers them) starts here too and finishes on `/onboarding`
 * with the same 상호명 question. Email sign-up IS its own onboarding, so `onboarding_completed` fires with it.
 */
export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < 6;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordTooShort) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    if (!terms) {
      setError("이용약관과 개인정보처리방침에 동의해야 가입할 수 있습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signup({
        email: email.trim(),
        password,
        name: name.trim(),
        orgName: orgName.trim(),
        termsAccepted: true,
        marketingConsent: marketing,
      });
      analytics.track("sign_up", { method: "email" });
      analytics.track("onboarding_completed");
      navigate(FIRST_RUN_PATH, { replace: true });
    } catch (err) {
      setError(signupFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="계정 만들기"
      subtitle="계정을 만들고 첫 채널을 연결해 보세요"
      footer={
        <>
          이미 계정이 있으신가요?{" "}
          <Link to="/login" className={authLink}>
            로그인
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to={PRODUCT_PATH} className={`${authLink} text-muted`}>
            제품 소개 보기
          </Link>
        </>
      }
    >
      <SocialSignInButtons intent="signup" />

      <form className="space-y-4" onSubmit={onSubmit} aria-label="회원가입">
        <div>
          <label className={authLabel} htmlFor="signup-org">
            상호 (스토어·회사 이름)
          </label>
          <input
            id="signup-org"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className={authField}
            autoComplete="organization"
            required
          />
        </div>
        <div>
          <label className={authLabel} htmlFor="signup-name">
            이름
          </label>
          <input
            id="signup-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={authField}
            autoComplete="name"
            required
          />
        </div>
        <div>
          <label className={authLabel} htmlFor="signup-email">
            이메일
          </label>
          <input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authField}
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label className={authLabel} htmlFor="signup-password">
            비밀번호 <span className="font-normal text-muted">(6자 이상)</span>
          </label>
          <input
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authField}
            autoComplete="new-password"
            minLength={6}
            required
            aria-invalid={passwordTooShort || undefined}
          />
        </div>
        <ConsentFields idPrefix="signup" terms={terms} marketing={marketing} onTerms={setTerms} onMarketing={setMarketing} />
        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={authPrimaryButton} disabled={busy}>
          {busy ? "계정 만드는 중…" : "계정 만들기"}
        </button>
        <p className="break-keep text-center text-xs leading-relaxed text-muted">
          가입하면 바로 채널 연결 화면으로 이동합니다. 마켓 계정 정보는 그 화면에서 채널별로 직접 입력합니다.
        </p>
      </form>
    </AuthCard>
  );
}
