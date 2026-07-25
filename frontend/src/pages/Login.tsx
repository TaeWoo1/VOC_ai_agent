import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { loginFailure } from "../lib/loginError";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("demo@sellerops.ai");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
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
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-3xl font-extrabold text-brand">SellerOps AI</p>
          <p className="mt-2 text-lg text-muted">여러 판매 채널을 한 곳에서 관리하세요</p>
        </div>
        <form className="card space-y-5" onSubmit={onSubmit}>
          <div>
            <label className="mb-2 block text-base font-semibold text-ink">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-3 text-lg focus:border-brand focus:outline-none"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-2 block text-base font-semibold text-ink">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-3 text-lg focus:border-brand focus:outline-none"
              autoComplete="current-password"
            />
          </div>
          {error ? <p className="text-base text-bad">{error}</p> : null}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "로그인 중…" : "로그인"}
          </button>
          <p className="text-center text-sm text-muted">데모 계정이 미리 입력되어 있습니다.</p>
        </form>
      </div>
    </div>
  );
}
