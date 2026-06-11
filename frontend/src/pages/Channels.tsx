import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { DataBadge } from "../components/DataBadge";
import { EmptyState } from "../components/EmptyState";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { relativeTime } from "../lib/format";
import type { ChannelResponse } from "../lib/types";

export function Channels() {
  const { data } = useApiData(() => api.getChannels());
  const [notice, setNotice] = useState<string | null>(null);
  const channels = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">채널 연결</h1>
        <p className="mt-1 text-lg text-muted">판매 채널을 연결하면 문의·리뷰·주문·매출을 한 곳에서 봅니다.</p>
      </div>

      {notice ? (
        <div className="rounded-xl bg-brand/10 px-4 py-3 text-brand-700">{notice}</div>
      ) : null}

      {channels.length === 0 ? (
        <EmptyState message="채널 정보를 불러오지 못했습니다." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((ch) => (
            <ChannelCard key={ch.id} channel={ch} onAction={setNotice} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelCard({
  channel,
  onAction,
}: {
  channel: ChannelResponse;
  onAction: (msg: string) => void;
}) {
  const navigate = useNavigate();
  const disabled = channel.status === "PREPARING";
  const canUpload =
    channel.status === "FILE_UPLOAD_SUPPORTED" || channel.actionLabel === "파일 업로드";

  function handleAction() {
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
        <StatusBadge status={channel.status} />
      </div>

      <div className="flex flex-wrap gap-2">
        {channel.dataBadges.length > 0 ? (
          channel.dataBadges.map((b) => <DataBadge key={b} label={b} />)
        ) : (
          <span className="text-sm text-muted">수집 항목 정보 없음</span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between">
        <span className="text-sm text-muted">
          {channel.lastSyncedAt ? `최근 동기화 ${relativeTime(channel.lastSyncedAt)}` : "동기화 이력 없음"}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={handleAction}
          className={
            channel.status === "CONNECTED"
              ? "btn-ghost"
              : disabled
                ? "btn-ghost cursor-not-allowed opacity-50"
                : "btn-primary px-4 py-2.5 text-base"
          }
        >
          {channel.actionLabel}
        </button>
      </div>
    </div>
  );
}
