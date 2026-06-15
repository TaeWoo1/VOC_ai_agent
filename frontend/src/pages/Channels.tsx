import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { HealthBadge } from "../components/HealthBadge";
import { DataBadge } from "../components/DataBadge";
import { EmptyState } from "../components/EmptyState";
import { useApiData } from "../lib/useApiData";
import { useOpenAlerts } from "../lib/openAlerts";
import { api } from "../lib/apiClient";
import { relativeTime } from "../lib/format";
import type {
  ChannelResponse,
  ConnectionStatusView,
  SellerAccountResponse,
} from "../lib/types";

export function Channels() {
  const { data } = useApiData(() => api.getChannels());
  const { data: accounts } = useApiData(() => api.getSellerAccounts());
  const { openCount } = useOpenAlerts();
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<Map<string, ConnectionStatusView>>(new Map());
  const channels = data ?? [];

  // Channel → the org's seller account on it (drives the 연결 관리 entry).
  const accountByChannel = useMemo(() => {
    const map = new Map<string, SellerAccountResponse>();
    for (const acc of accounts ?? []) {
      if (!acc.fileUpload) {
        map.set(acc.channelId, acc);
      }
    }
    return map;
  }, [accounts]);

  // Per-account connection health. Strict (no fake fallback in real mode) but
  // fail-soft per account: a failed status fetch just leaves that row showing the
  // catalog status, never blocks the page. The channel catalog read above is
  // unchanged. No mutation is issued from this page.
  useEffect(() => {
    const connected = (accounts ?? []).filter((a) => !a.fileUpload);
    if (connected.length === 0) {
      return;
    }
    let cancelled = false;
    Promise.allSettled(
      connected.map((a) =>
        api.getConnectionStatusStrict(a.id).then((s) => [a.id, s] as const),
      ),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const map = new Map<string, ConnectionStatusView>();
      for (const r of results) {
        if (r.status === "fulfilled") {
          map.set(r.value[0], r.value[1]);
        }
      }
      setHealth(map);
    });
    return () => {
      cancelled = true;
    };
  }, [accounts]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">채널 연결</h1>
        <p className="mt-1 text-lg text-muted">
          판매 채널을 연결하면 문의·리뷰·주문·매출이 자동으로 한 곳에 모입니다. 자동 연결을 우선
          지원하며, 일부 채널은 안내에 따라 키를 등록해 연결합니다.
        </p>
        <p className="mt-1 text-base text-muted">
          파일 업로드는 자동 연결이 어려울 때 쓰는 백업 방식입니다.
        </p>
      </div>

      {openCount > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-warn/10 px-4 py-3 text-warn">
          <span className="font-semibold">확인 필요한 연결 알림 {openCount}건</span>
          <Link to="/alerts" className="btn-ghost shrink-0">
            확인하기 →
          </Link>
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl bg-brand/10 px-4 py-3 text-brand-700">{notice}</div>
      ) : null}

      {channels.length === 0 ? (
        <EmptyState message="채널 정보를 불러오지 못했습니다." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((ch) => {
            const account = accountByChannel.get(ch.id) ?? null;
            return (
              <ChannelCard
                key={ch.id}
                channel={ch}
                account={account}
                health={account ? health.get(account.id) ?? null : null}
                onAction={setNotice}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChannelCard({
  channel,
  account,
  health,
  onAction,
}: {
  channel: ChannelResponse;
  account: SellerAccountResponse | null;
  health: ConnectionStatusView | null;
  onAction: (msg: string) => void;
}) {
  const navigate = useNavigate();
  const disabled = channel.status === "PREPARING";
  const canUpload =
    channel.status === "FILE_UPLOAD_SUPPORTED" || channel.actionLabel === "파일 업로드";

  // Prefer live connection health when we have it; the failure block surfaces the
  // last failure reason + consecutive-failure count for a connected account.
  const lastCollected = health?.lastSyncedAt ?? channel.lastSyncedAt;
  const failing = !!health && (health.consecutiveFailures > 0 || !!health.lastError);

  function handleAction() {
    if (account) {
      navigate(`/channels/${account.id}`);
      return;
    }
    if (canUpload) {
      navigate(`/upload?channelId=${channel.id}`);
      return;
    }
    onAction(`'${channel.nameKo}' 채널의 [${channel.actionLabel}] 동작은 다음 단계에서 연결됩니다.`);
  }

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between">
        <span className="text-xl font-bold">{channel.nameKo}</span>
        {health ? <HealthBadge state={health.state} /> : <StatusBadge status={channel.status} />}
      </div>

      <div className="flex flex-wrap gap-2">
        {channel.dataBadges.length > 0 ? (
          channel.dataBadges.map((b) => <DataBadge key={b} label={b} />)
        ) : (
          <span className="text-sm text-muted">수집 항목 정보 없음</span>
        )}
      </div>

      {failing ? (
        <div className="rounded-lg bg-bad/5 px-3 py-2 text-sm">
          <p className="font-semibold text-bad">연속 실패 {health.consecutiveFailures}회</p>
          {health.lastError ? <p className="mt-0.5 text-muted">{health.lastError}</p> : null}
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="text-sm text-muted">
          {lastCollected ? `마지막 수집 ${relativeTime(lastCollected)}` : "수집 이력 없음"}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={handleAction}
          className={
            account
              ? "btn-ghost"
              : disabled
                ? "btn-ghost cursor-not-allowed opacity-50"
                : "btn-primary px-4 py-2.5 text-base"
          }
        >
          {account ? (failing ? "재연결·테스트" : "연결 관리") : channel.actionLabel}
        </button>
      </div>
    </div>
  );
}
