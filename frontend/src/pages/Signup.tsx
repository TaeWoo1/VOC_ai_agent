import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { signupFailure } from "../lib/signupError";
import { PRODUCT_PATH } from "../lib/public/publicCta";

/** Where a brand-new org lands: nothing is connected yet, so the first thing to do IS 채널 연결. */
export const FIRST_RUN_PATH = "/connect";

/**
 * 회원가입 (`/signup`) — the first screen of the Self-Pilot first-run journey
 * (가입 → 채널 연결 → 첫 수집 → 홈). Uses the existing `POST /api/auth/signup`; the answer is a session
 * (token + user), so a successful sign-up goes straight to 채널 연결 with no second login form.
 *
 * Deliberately plain: four fields the backend contract names (email, password ≥ 6, name, orgName), one
 * error line in the seller's words, and no marketing. Nothing here touches a marketplace or a channel.
 */
export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < 6;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordTooShort) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signup({ email: email.trim(), password, name: name.trim(), orgName: orgName.trim() });
      navigate(FIRST_RUN_PATH, { replace: true });
    } catch (err) {
      setError(signupFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-xl border border-line px-4 py-3 text-lg focus:border-brand focus:outline-none";
  const label = "mb-2 block text-base font-semibold text-ink";

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-3xl font-extrabold text-brand-700">SellerOps</p>
          <p className="mt-2 text-lg text-muted">계정을 만들고 첫 채널을 연결해 보세요</p>
        </div>

        <form className="card space-y-5" onSubmit={onSubmit} aria-label="회원가입">
          <div>
            <label className={label} htmlFor="signup-org">
              상호 (스토어·회사 이름)
            </label>
            <input
              id="signup-org"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className={field}
              autoComplete="organization"
              required
            />
          </div>
          <div>
            <label className={label} htmlFor="signup-name">
              이름
            </label>
            <input
              id="signup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
              autoComplete="name"
              required
            />
          </div>
          <div>
            <label className={label} htmlFor="signup-email">
              이메일
            </label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className={label} htmlFor="signup-password">
              비밀번호 <span className="font-normal text-muted">(6자 이상)</span>
            </label>
            <input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
              autoComplete="new-password"
              minLength={6}
              required
              aria-invalid={passwordTooShort || undefined}
            />
          </div>
          {error ? (
            <p className="text-base text-bad" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-xl bg-brand-700 px-5 py-3 text-lg font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
            disabled={busy}
          >
            {busy ? "계정 만드는 중…" : "계정 만들기"}
          </button>
          <p className="break-keep text-center text-sm text-muted">
            가입하면 바로 채널 연결 화면으로 이동합니다. 마켓 계정 정보는 그 화면에서 채널별로 직접 입력합니다.
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          이미 계정이 있으신가요?{" "}
          <Link
            to="/login"
            className="rounded font-medium text-brand-700 transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            로그인
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
