import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/apiClient";
import { loginFailure } from "../lib/loginError";
import { PRODUCT_PATH } from "../lib/public/publicCta";
import { analytics } from "../lib/analytics";
import { AuthCard, authField, authLabel, authLink, authPrimaryButton } from "../components/auth/AuthCard";
import { AuthNotice } from "../components/auth/AuthNotice";
import { SocialSignInButtons } from "../components/auth/SocialSignInButtons";

/**
 * Why a social sign-in came back here instead of signing in — the backend's outcome
 * (`SocialLoginOutcome`), in the seller's words. Keyed by `?social=`; unknown values show nothing.
 * `email_taken` is the fail-closed rule: an email that already has a SellerOps account is never auto-linked
 * (docs/auth_growth_instrumentation_v1.md §2-2).
 */
export const SOCIAL_NOTICE: Record<string, { title: string; body: string }> = {
  email_taken: {
    title: "이미 이 이메일로 가입된 계정이 있어요",
    body: "같은 이메일의 이메일·비밀번호 계정이 있어 소셜 로그인으로 자동 연결하지 않았습니다. 아래에서 이메일과 비밀번호로 로그인해 주세요.",
  },
  email_missing: {
    title: "이메일 정보를 받지 못했어요",
    body: "소셜 계정에서 이메일 제공에 동의해야 SellerOps 계정을 만들 수 있습니다. 동의 후 다시 시도하거나 이메일로 가입해 주세요.",
  },
  failed: {
    title: "소셜 로그인이 완료되지 않았어요",
    body: "로그인이 취소되었거나 확인에 실패했습니다. 다시 시도하거나 이메일로 로그인해 주세요.",
  },
};

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // `?demo=1` is the entry the public page's "데모 화면 보기" CTA uses. It changes nothing about
  // authentication — it only tells the visitor, plainly, what they are about to look at.
  const fromDemoEntry = searchParams.get("demo") === "1";
  // `?expired=1` is where the API client sends a session whose token stopped being accepted (12h JWT,
  // longer self-pilot days). It changes nothing about authentication — it tells the seller, plainly, that
  // nothing is broken and the one thing to do is sign in again.
  const sessionExpired = searchParams.get("expired") === "1";
  const socialNotice = SOCIAL_NOTICE[searchParams.get("social") ?? ""] ?? null;
  // `?reset=1` — the seller just set a new password on /reset-password (docs/service_readiness_v1.md §6).
  const passwordReset = searchParams.get("reset") === "1";
  // The reset entry exists only when a mailed link can reach someone (SMTP or the dev outbox) — a link to a
  // form whose mail is dropped would be a lie. Until the answer arrives, no link (never a flicker of a dead one).
  const [resetAvailable, setResetAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .passwordResetConfig()
      .then((c) => alive && setResetAvailable(c.enabled))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  // The demo account is pre-filled ONLY on the demo entry. A real seller (Self-Pilot first-run) starts from an
  // empty form — a product whose login form arrives filled with someone else's account is not a product.
  const [email, setEmail] = useState(fromDemoEntry ? "demo@sellerops.ai" : "");
  const [password, setPassword] = useState(fromDemoEntry ? "demo1234" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      analytics.track("login", { method: "email" });
      navigate("/", { replace: true });
    } catch (e) {
      // "Check your password" for a request that never reached the backend sends the seller to change something
      // that was never wrong — it cost most of an hour on 2026-07-25. See `loginError.ts`.
      setError(loginFailure(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="로그인"
      subtitle="채널에 흩어진 고객 응대를 한곳에서"
      footer={
        <>
          처음이신가요?{" "}
          <Link to="/signup" className={authLink}>
            계정 만들기
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to={PRODUCT_PATH} className={`${authLink} text-muted`}>
            제품 소개 보기
          </Link>
        </>
      }
    >
      {sessionExpired ? (
        <AuthNotice title="세션이 만료되었습니다">
          오래 사용하지 않아 로그인 상태가 풀렸습니다. 다시 로그인하면 하던 자리로 이어집니다. 채널 연결과 수집 설정은
          그대로 남아 있습니다.
        </AuthNotice>
      ) : null}

      {passwordReset ? (
        <AuthNotice tone="success" title="비밀번호가 바뀌었어요">
          새 비밀번호로 로그인해 주세요.
        </AuthNotice>
      ) : null}

      {socialNotice ? (
        <AuthNotice title={socialNotice.title}>{socialNotice.body}</AuthNotice>
      ) : null}

      {fromDemoEntry ? (
        <AuthNotice title="데모 계정으로 둘러보는 중입니다">
          계정 정보가 미리 입력되어 있습니다. 화면에 보이는 내용은 실제 판매 데이터가 아닙니다.
        </AuthNotice>
      ) : null}

      <SocialSignInButtons intent="login" />

      <form className="space-y-4" onSubmit={onSubmit} aria-label="로그인">
        <div>
          <label className={authLabel} htmlFor="login-email">
            이메일
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authField}
            autoComplete="username"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label className={`${authLabel} mb-0`} htmlFor="login-password">
              비밀번호
            </label>
            {resetAvailable ? (
              <Link to="/forgot-password" className={`${authLink} text-sm`}>
                비밀번호를 잊으셨나요?
              </Link>
            ) : null}
          </div>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authField}
            autoComplete="current-password"
          />
        </div>
        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={authPrimaryButton} disabled={busy}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </AuthCard>
  );
}
