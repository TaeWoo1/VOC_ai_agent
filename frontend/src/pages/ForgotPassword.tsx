import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/apiClient";
import { AuthCard, authField, authLabel, authLink, authPrimaryButton } from "../components/auth/AuthCard";
import { AuthNotice } from "../components/auth/AuthNotice";

export const FORGOT_SENT_TITLE = "가입된 이메일이면 재설정 안내를 보냈어요";

/**
 * `/forgot-password` (docs/service_readiness_v1.md §6). Whatever the address, the answer is the same sentence —
 * the server never says whether an account exists or how it signs in. Under the dev outbox (local/self-pilot)
 * the page says where the mail actually went, because there is no inbox to check.
 */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devOutbox, setDevOutbox] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .passwordResetConfig()
      .then((c) => alive && setDevOutbox(c.devOutbox))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch {
      setError("요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <Link to="/login" className={authLink}>
      로그인으로 돌아가기
    </Link>
  );

  if (sent) {
    return (
      <AuthCard title="메일을 확인해 주세요" footer={footer}>
        <AuthNotice tone="success" title={FORGOT_SENT_TITLE}>
          메일의 링크는 30분 동안 한 번만 사용할 수 있어요. 메일이 오지 않으면 주소를 다시 확인하거나 소셜 계정으로 로그인해
          보세요.
        </AuthNotice>
        {devOutbox ? (
          <AuthNotice title="개발 모드: 메일은 backend 로그에 출력됩니다">
            SMTP가 설정되지 않은 로컬 환경입니다. backend 터미널의 <code>[DEV MAIL OUTBOX]</code> 줄에서 재설정 링크를
            여세요.
          </AuthNotice>
        ) : null}
      </AuthCard>
    );
  }

  return (
    <AuthCard title="비밀번호 재설정" subtitle="가입한 이메일로 재설정 링크를 보내드려요" footer={footer}>
      <form className="space-y-4" onSubmit={onSubmit} aria-label="비밀번호 재설정 요청">
        <div>
          <label className={authLabel} htmlFor="forgot-email">
            이메일
          </label>
          <input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authField}
            autoComplete="username"
            required
            autoFocus
          />
        </div>
        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={authPrimaryButton} disabled={busy}>
          {busy ? "보내는 중…" : "재설정 링크 보내기"}
        </button>
        <p className="break-keep text-center text-xs leading-relaxed text-muted">
          Google · NAVER로 가입한 계정은 비밀번호가 없어요. 해당 버튼으로 로그인해 주세요.
        </p>
      </form>
    </AuthCard>
  );
}
