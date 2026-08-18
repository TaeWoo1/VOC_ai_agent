import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { parseCafe24Result, type Cafe24ResultStatus } from "../lib/cafe24Connect";
import { analytics } from "../lib/analytics";

// Success is shown ONLY from the backend-provided status param — never inferred from
// client state. code/state/token params are never read (parseCafe24Result ignores them).
const COPY: Record<
  Cafe24ResultStatus,
  { tone: "good" | "warn" | "bad"; title: string; detail: string; retry: boolean }
> = {
  connected: {
    tone: "good",
    title: "카페24 연결이 완료되었습니다.",
    detail: "이제 문의·리뷰·주문이 자동으로 수집됩니다.",
    retry: false,
  },
  reconnect_required: {
    tone: "warn",
    title: "카페24 연결을 마치지 못했습니다.",
    detail: "동의가 완료되지 않았습니다. 다시 시도해 주세요.",
    retry: true,
  },
  invalid: {
    tone: "bad",
    title: "연결 요청이 유효하지 않습니다.",
    detail: "요청이 만료되었거나 확인할 수 없습니다. 다시 시도해 주세요.",
    retry: true,
  },
  unknown: {
    tone: "bad",
    title: "연결 결과를 확인할 수 없습니다.",
    detail: "채널 연결 화면에서 상태를 확인하거나 다시 시도해 주세요.",
    retry: true,
  },
};

const TONE_CLASS: Record<"good" | "warn" | "bad", string> = {
  good: "bg-good/10 text-good",
  warn: "bg-warn/10 text-warn",
  bad: "bg-bad/10 text-bad",
};

export function Cafe24ConnectResult() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { status, accountId } = parseCafe24Result(params);

  // On a successful callback, hand off to the first-connection tutorial so verification +
  // the first read-only sync resume automatically. Only the sanitized status/accountId are
  // forwarded — never an OAuth code/state/token. Non-success results stay on this card.
  useEffect(() => {
    if (status !== "connected") {
      return;
    }
    // Growth funnel: Cafe24 connected (status only — never the account id).
    analytics.track("channel_connected", { channel: "cafe24" });
    const query = new URLSearchParams({ status });
    if (accountId) {
      query.set("accountId", accountId);
    }
    navigate(`/connect/cafe24/tutorial?${query.toString()}`, { replace: true });
  }, [status, accountId, navigate]);

  const copy = COPY[status];

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">카페24 연결 결과</h1>
      <div className="card space-y-3">
        <div className={`rounded-xl px-4 py-3 ${TONE_CLASS[copy.tone]}`}>
          <p className="text-lg font-semibold">{copy.title}</p>
        </div>
        <p className="text-base text-muted">{copy.detail}</p>
        <div className="flex items-center gap-3 pt-1">
          <Link to="/settings/channels" className="btn-ghost">
            채널 연결로 돌아가기
          </Link>
          {copy.retry ? (
            <Link to="/connect/cafe24" className="btn-primary px-4 py-2.5 text-base">
              다시 연결하기
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
