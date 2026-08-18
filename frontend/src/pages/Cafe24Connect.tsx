import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/apiClient";
import { analytics } from "../lib/analytics";
import { classifyStartError, normalizeMallId } from "../lib/cafe24Connect";

/**
 * Cafe24 connect start: the seller enters a mall id and begins the OAuth flow. On a
 * successful start the browser is redirected to Cafe24's consent screen; the backend
 * callback then returns to {@code /connect/cafe24/result}. No OAuth code/state/token
 * or secret is ever read, rendered, stored, or logged here.
 */
export function Cafe24Connect() {
  const [mallId, setMallId] = useState("");
  // Growth funnel: the Cafe24 connect flow was opened (no mall id leaves the page).
  useEffect(() => {
    analytics.track("channel_connect_started", { channel: "cafe24" });
  }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = normalizeMallId(mallId) !== null && !pending;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return; // guard against duplicate clicks / double submit
    }
    const mall = normalizeMallId(mallId);
    if (mall === null) {
      setError("몰 ID 형식이 올바르지 않습니다. 영문 소문자·숫자·하이픈만 사용할 수 있습니다.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await api.startCafe24Connect(mall);
      // Leave the SPA for Cafe24's consent screen. authorizationUrl carries the state
      // param — it is only handed to the browser, never stored or logged.
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setError(classifyStartError(err));
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">카페24 연결</h1>
        <p className="mt-1 text-lg text-muted">
          카페24 자사몰의 몰 ID를 입력하고 연결을 시작하면, 카페24 로그인·동의 화면으로 이동합니다.
          동의를 마치면 자동으로 연결됩니다.
        </p>
        <p className="mt-1 text-base text-muted">
          카페24 자사몰 관리자에서 앱 연동(OAuth)으로 연결합니다.
        </p>
      </div>

      <form className="card space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="cafe24-mall-id" className="mb-2 block text-base font-semibold text-ink">
            몰 ID
          </label>
          <input
            id="cafe24-mall-id"
            className="w-full rounded-xl border border-line px-4 py-3 text-lg focus:border-brand focus:outline-none"
            value={mallId}
            onChange={(event) => setMallId(event.target.value)}
            placeholder="예: mystore"
            autoComplete="off"
            disabled={pending}
          />
          <p className="mt-2 text-sm text-muted">
            자사몰 주소 앞부분입니다. 예: mystore.cafe24.com → mystore
          </p>
        </div>

        {error ? <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">{error}</div> : null}

        <div className="flex items-center justify-between gap-3">
          <Link to="/settings/channels" className="btn-ghost">
            채널 연결로 돌아가기
          </Link>
          <button type="submit" disabled={!canSubmit} className="btn-primary">
            {pending ? "연결 중…" : "카페24 연결하기"}
          </button>
        </div>
      </form>
    </div>
  );
}
