import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/apiClient";
import { analytics } from "../lib/analytics";
import { signupFailure } from "../lib/signupError";
import {
  authMethodOf,
  clearPendingOnboarding,
  PROVIDER_LABEL,
  readPendingOnboarding,
} from "../lib/socialOnboarding";
import { AuthCard, authField, authLabel, authLink, authPrimaryButton } from "../components/auth/AuthCard";
import { AuthNotice } from "../components/auth/AuthNotice";
import { ConsentFields } from "../components/auth/ConsentFields";
import { FIRST_RUN_PATH } from "./Signup";

/**
 * `/onboarding` — the one question a first-time Google/NAVER sign-in still owes: 상호명 (and a name to call the
 * person by, prefilled from the provider). Nothing exists on the backend yet; submitting creates org + user +
 * identity in one transaction and answers a session, then the first-run journey continues at 채널 연결.
 * Without a pending onboarding in this tab there is nothing to do here → `/signup`.
 */
export function Onboarding() {
  const navigate = useNavigate();
  const { acceptSession } = useAuth();
  const pending = useMemo(() => readPendingOnboarding(), []);
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState(pending?.name ?? "");
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) {
      navigate("/signup", { replace: true });
      return;
    }
    analytics.track("onboarding_started");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!pending) return null;
  const providerLabel = PROVIDER_LABEL[pending.provider] ?? pending.provider;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    if (!terms) {
      setError("이용약관과 개인정보처리방침에 동의해야 가입할 수 있습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await api.socialOnboardingComplete({
        onboardingToken: pending.onboardingToken,
        orgName: orgName.trim(),
        name: name.trim(),
        termsAccepted: true,
        marketingConsent: marketing,
      });
      clearPendingOnboarding();
      acceptSession(session);
      const method = authMethodOf(pending.provider);
      if (method) analytics.track("sign_up", { method });
      analytics.track("onboarding_completed");
      navigate(FIRST_RUN_PATH, { replace: true });
    } catch (err) {
      const status = (err as { response?: { status?: number } } | null)?.response?.status;
      if (status === 401) {
        clearPendingOnboarding();
        setExpired(true);
      } else {
        setError(signupFailure(err).message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (expired) {
    return (
      <AuthCard title="가입 세션이 만료되었어요">
        <AuthNotice tone="error" title="시간이 지나 가입을 이어갈 수 없습니다">
          {providerLabel} 계정으로 다시 로그인하면 이 화면으로 돌아옵니다.
        </AuthNotice>
        <Link to="/signup" className={`${authLink} block text-center text-base`}>
          계정 만들기로 돌아가기
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="거의 다 됐어요" subtitle="스토어 이름만 알려주시면 계정이 만들어집니다">
      <div className="rounded-xl border border-line bg-canvas px-4 py-3 text-sm text-muted" role="status">
        <span className="font-semibold text-ink">{providerLabel} 계정</span>
        {pending.email ? <span> · {pending.email}</span> : null}
        <span>으로 가입 중입니다.</span>
      </div>
      <form className="space-y-4" onSubmit={onSubmit} aria-label="가입 마무리">
        <div>
          <label className={authLabel} htmlFor="onboarding-org">
            상호 (스토어·회사 이름)
          </label>
          <input
            id="onboarding-org"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className={authField}
            autoComplete="organization"
            required
            autoFocus
          />
        </div>
        <div>
          <label className={authLabel} htmlFor="onboarding-name">
            이름
          </label>
          <input
            id="onboarding-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={authField}
            autoComplete="name"
            required
          />
        </div>
        <ConsentFields idPrefix="onboarding" terms={terms} marketing={marketing} onTerms={setTerms} onMarketing={setMarketing} />
        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={authPrimaryButton} disabled={busy}>
          {busy ? "계정 만드는 중…" : "시작하기"}
        </button>
        <p className="break-keep text-center text-xs leading-relaxed text-muted">
          다음 화면에서 NAVER · Coupang · Cafe24 채널을 연결합니다. 마켓 계정 정보는 그 화면에서 채널별로 직접 입력합니다.
        </p>
      </form>
    </AuthCard>
  );
}
