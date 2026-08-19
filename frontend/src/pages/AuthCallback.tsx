import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/apiClient";
import { useAuth } from "../lib/auth";
import { analytics } from "../lib/analytics";
import { authMethodOf, savePendingOnboarding } from "../lib/socialOnboarding";
import { takeUrlSecret } from "../lib/urlSecrets";
import { AuthCard, authLink } from "../components/auth/AuthCard";

export const ONBOARDING_PATH = "/onboarding";

/**
 * `/auth/callback?code=…` — where the backend sends the browser after Google/NAVER said yes. The URL carries
 * only a one-time code (never a JWT); this page spends it once (`POST /api/auth/social/exchange`) and either
 * accepts the session (→ 홈) or stores the pending onboarding (→ `/onboarding`). A code that is spent, expired
 * or unknown is "다시 로그인", not an error screen (docs/auth_growth_instrumentation_v1.md §2-1, §2-3).
 */
export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { acceptSession } = useAuth();
  const [failed, setFailed] = useState(false);
  const spent = useRef(false);

  // `main.tsx` lifted the code out of the URL before any vendor started (docs/service_readiness_v1.md §2-1);
  // the query is the fallback for a direct render (tests). Read once, synchronously, so StrictMode's second
  // effect run sees the same value.
  const initialCode = useRef<string | null>(null);
  if (initialCode.current === null) initialCode.current = takeUrlSecret("code") ?? searchParams.get("code") ?? "";

  useEffect(() => {
    const code = initialCode.current;
    if (!code) {
      navigate("/login?social=failed", { replace: true });
      return;
    }
    // React 18 StrictMode double-invokes effects in dev (same instance, refs kept); the code is single-use on
    // the server, so the FIRST run owns the exchange and its result — no "still mounted" flag, which the
    // StrictMode cleanup would flip to false before the answer arrives.
    if (spent.current) return;
    spent.current = true;
    (async () => {
      try {
        const res = await api.socialExchange(code);
        if (res.status === "SIGNED_IN") {
          acceptSession({ token: res.token, user: res.user });
          const method = authMethodOf(res.provider);
          if (method) analytics.track("login", { method });
          navigate("/", { replace: true });
          return;
        }
        savePendingOnboarding({
          onboardingToken: res.onboardingToken,
          provider: res.provider,
          email: res.email,
          name: res.name,
        });
        navigate(ONBOARDING_PATH, { replace: true });
      } catch {
        setFailed(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <AuthCard title="로그인을 이어가지 못했어요">
        <p className="text-base text-ink">로그인 링크가 만료되었거나 이미 사용되었습니다.</p>
        <p className="text-sm text-muted">다시 로그인하면 됩니다. 채널 연결과 수집 설정은 그대로 남아 있습니다.</p>
        <Link to="/login" className={`${authLink} block text-center text-base`}>
          로그인 화면으로
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="로그인 확인 중…">
      <p className="text-center text-base text-muted" role="status">
        잠시만 기다려 주세요.
      </p>
    </AuthCard>
  );
}
