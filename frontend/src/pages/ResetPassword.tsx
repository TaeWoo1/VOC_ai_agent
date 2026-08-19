import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/apiClient";
import { AuthCard, authField, authLabel, authLink, authPrimaryButton } from "../components/auth/AuthCard";
import { AuthNotice } from "../components/auth/AuthNotice";
import { takeUrlSecret } from "../lib/urlSecrets";

export const RESET_DONE_PATH = "/login?reset=1";

/**
 * `/reset-password?token=…` (docs/service_readiness_v1.md §6). `main.tsx` already lifted the token out of the
 * URL before Sentry/analytics started (`captureUrlSecrets`); this page takes it from there (falling back to the
 * query for a direct render) and keeps it only in component state until the form is sent. 401 = the link is
 * spent or expired → "다시 요청".
 */
export function ResetPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialToken = useRef<string | null>(null);
  if (initialToken.current === null) {
    initialToken.current = takeUrlSecret("token") ?? new URLSearchParams(location.search).get("token") ?? "";
  }
  const [token] = useState(() => initialToken.current ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spent, setSpent] = useState(false);

  useEffect(() => {
    if (location.search.includes("token=")) {
      navigate(location.pathname, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tooShort) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    if (password !== confirm) {
      setError("두 비밀번호가 서로 달라요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      navigate(RESET_DONE_PATH, { replace: true });
    } catch (err) {
      const status = (err as { response?: { status?: number } } | null)?.response?.status;
      if (status === 401) setSpent(true);
      else if (status === 400) setError("비밀번호는 6자 이상이어야 합니다.");
      else setError("변경하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const again = (
    <Link to="/forgot-password" className={authLink}>
      재설정 링크 다시 요청
    </Link>
  );

  if (!token || spent) {
    return (
      <AuthCard title="링크를 사용할 수 없어요" footer={<Link to="/login" className={authLink}>로그인으로 돌아가기</Link>}>
        <AuthNotice tone="error" title="링크가 만료되었거나 이미 사용되었어요" action={again}>
          재설정 링크는 30분 동안 한 번만 쓸 수 있어요. 새 링크를 요청해 주세요.
        </AuthNotice>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="새 비밀번호 설정" subtitle="새 비밀번호를 두 번 입력해 주세요">
      <form className="space-y-4" onSubmit={onSubmit} aria-label="새 비밀번호 설정">
        <div>
          <label className={authLabel} htmlFor="reset-password">
            새 비밀번호 <span className="font-normal text-muted">(6자 이상)</span>
          </label>
          <input
            id="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authField}
            autoComplete="new-password"
            minLength={6}
            required
            autoFocus
            aria-invalid={tooShort || undefined}
          />
        </div>
        <div>
          <label className={authLabel} htmlFor="reset-confirm">
            새 비밀번호 확인
          </label>
          <input
            id="reset-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={authField}
            autoComplete="new-password"
            required
            aria-invalid={mismatch || undefined}
          />
        </div>
        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={authPrimaryButton} disabled={busy}>
          {busy ? "변경하는 중…" : "비밀번호 변경"}
        </button>
      </form>
    </AuthCard>
  );
}
