import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { loginFailure } from "../lib/loginError";
import { PRODUCT_PATH } from "../lib/public/publicCta";

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
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-3xl font-extrabold text-brand-700">SellerOps</p>
          <p className="mt-2 text-lg text-muted">채널에 흩어진 고객 응대를 한곳에서</p>
        </div>

        {sessionExpired ? (
          <div className="mb-5 rounded-xl border border-line bg-canvas px-5 py-4" role="status">
            <p className="text-base font-semibold text-ink">세션이 만료되었습니다</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              오래 사용하지 않아 로그인 상태가 풀렸습니다. 다시 로그인하면 하던 자리로 이어집니다. 채널 연결과
              수집 설정은 그대로 남아 있습니다.
            </p>
          </div>
        ) : null}

        {fromDemoEntry ? (
          <div className="mb-5 rounded-xl border border-line bg-canvas px-5 py-4">
            <p className="text-base font-semibold text-ink">데모 계정으로 둘러보는 중입니다</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              계정 정보가 미리 입력되어 있습니다. 화면에 보이는 내용은 실제 판매 데이터가 아닙니다.
            </p>
          </div>
        ) : null}

        <form className="card space-y-5" onSubmit={onSubmit}>
          <div>
            <label className="mb-2 block text-base font-semibold text-ink" htmlFor="login-email">
              이메일
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-3 text-lg focus:border-brand focus:outline-none"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-2 block text-base font-semibold text-ink" htmlFor="login-password">
              비밀번호
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-3 text-lg focus:border-brand focus:outline-none"
              autoComplete="current-password"
            />
          </div>
          {error ? <p className="text-base text-bad">{error}</p> : null}
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-xl bg-brand-700 px-5 py-3 text-lg font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
            disabled={busy}
          >
            {busy ? "로그인 중…" : "로그인"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          처음이신가요?{" "}
          <Link
            to="/signup"
            className="rounded font-medium text-brand-700 transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            계정 만들기
          </Link>
          <span aria-hidden="true"> · </span>
          <Link
            to={PRODUCT_PATH}
            className="rounded font-medium transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            제품 소개 보기
          </Link>
        </p>
      </div>
    </div>
  );
}
