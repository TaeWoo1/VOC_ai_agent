import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { useApiData } from "../lib/useApiData";
import { useOpenAlerts } from "../lib/openAlerts";
import { api } from "../lib/apiClient";
import { relativeTime } from "../lib/format";
import type { ConnectorAlertView } from "../lib/types";

type Tone = "bad" | "warn" | "muted";

const TONE_CLS: Record<Tone, string> = {
  bad: "bg-bad/10 text-bad",
  warn: "bg-warn/10 text-warn",
  muted: "bg-ink/5 text-muted",
};

// Per-type label + tone + suggested next action. AUTH_EXPIRED reads as 재연결 필요
// (actionable), not a catastrophic service failure.
const TYPE_META: Record<string, { label: string; tone: Tone; action: string }> = {
  AUTH_EXPIRED: {
    label: "재연결 필요",
    tone: "bad",
    action: "인증이 만료되었습니다. 채널에서 재연결해 주세요.",
  },
  REPEATED_FAILURE: {
    label: "반복 수집 실패",
    tone: "warn",
    action: "수집이 반복해서 실패했습니다. 연결 상태를 점검해 주세요.",
  },
  RATE_LIMITED: {
    label: "수집 지연 (속도 제한)",
    tone: "warn",
    action: "잠시 후 자동으로 다시 시도합니다. 반복되면 점검이 필요합니다.",
  },
};

function metaFor(alert: ConnectorAlertView): { label: string; tone: Tone; action: string } {
  const base = TYPE_META[alert.type] ?? {
    label: alert.type,
    tone: "muted" as Tone,
    action: "채널 상세에서 연결 상태를 확인해 주세요.",
  };
  // Severity can escalate the tone, but never overstate (avoid "critical" wording
  // in the chip itself — the type label carries the meaning).
  return alert.severity === "CRITICAL" ? { ...base, tone: "bad" } : base;
}

// Open (unacknowledged) first, then newest. Mirrors the backend list ordering so
// a locally-acknowledged card moves to the bottom without a refetch.
function sortOpenFirst(list: ConnectorAlertView[]): ConnectorAlertView[] {
  return [...list].sort((a, b) => {
    const ackA = a.acknowledgedAt != null;
    const ackB = b.acknowledgedAt != null;
    if (ackA !== ackB) {
      return ackA ? 1 : -1;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function AlertSettings() {
  const { data, loading, error } = useApiData(() => api.getConnectorAlertsStrict());
  const { refresh, syncOpenCount } = useOpenAlerts();
  // Local working copy so an acknowledge can update a card in place. Real mode
  // reconciles against the returned view; mock mode (no backend) keeps the local
  // mark. Both roll back on failure. The shared open-alert count (sidebar badge /
  // channels banner) is kept in step with this list on every transition.
  const [list, setList] = useState<ConnectorAlertView[]>([]);
  const [ackBusyId, setAckBusyId] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      const sorted = sortOpenFirst(data);
      setList(sorted);
      syncOpenCount(sorted);
    }
  }, [data, syncOpenCount]);

  async function acknowledge(alert: ConnectorAlertView) {
    setAckBusyId(alert.id);
    setAckError(null);
    const prev = list;
    // Optimistic: mark as acknowledged now and re-sort to the bottom; drop the
    // shared open count immediately (works in mock mode too — no fetch).
    const optimistic = sortOpenFirst(
      list.map((a) =>
        a.id === alert.id ? { ...a, acknowledgedAt: new Date().toISOString() } : a,
      ),
    );
    setList(optimistic);
    syncOpenCount(optimistic);
    try {
      const updated = await api.acknowledgeConnectorAlert(alert.id);
      if (updated) {
        // Real mode: reconcile against the authoritative server view, then
        // confirm the shared count against backend truth via a re-fetch.
        const reconciled = sortOpenFirst(
          optimistic.map((a) => (a.id === updated.id ? updated : a)),
        );
        setList(reconciled);
        syncOpenCount(reconciled);
        void refresh();
      }
      // Mock mode (updated == null): the optimistic decrement stands — refreshing
      // would re-read the static seed and restore the count.
    } catch {
      setList(prev); // roll back the optimistic mark
      syncOpenCount(prev);
      setAckError("확인 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setAckBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">연결 알림</h1>
        <p className="mt-1 text-lg text-muted">
          채널 연결·수집에서 발생한 알림입니다. 점검이 필요한 항목은 채널에서 재연결하거나 테스트할
          수 있습니다.
        </p>
        <p className="mt-1 text-sm text-muted">
          확인 처리는 알림을 봤다는 표시이며, 연결 문제 해결을 의미하지 않습니다.
        </p>
      </div>

      {ackError ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">{ackError}</div>
      ) : null}

      {loading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : error ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
          연결 알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </div>
      ) : list.length === 0 ? (
        <EmptyState message="현재 확인할 연결 알림이 없습니다." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {list.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              busy={ackBusyId === alert.id}
              onAcknowledge={() => acknowledge(alert)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  busy,
  onAcknowledge,
}: {
  alert: ConnectorAlertView;
  busy: boolean;
  onAcknowledge: () => void;
}) {
  const navigate = useNavigate();
  const meta = metaFor(alert);
  const channel = alert.channelNameKo ?? "채널";
  const where = alert.accountAlias ? `${channel} · ${alert.accountAlias}` : channel;
  const acknowledged = alert.acknowledgedAt != null;

  return (
    <div className={`card flex flex-col gap-3 p-5 ${acknowledged ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${TONE_CLS[meta.tone]}`}
          >
            {meta.label}
          </span>
          {acknowledged ? (
            <span className="ml-2 inline-flex items-center rounded-full bg-ink/5 px-3 py-1 text-sm font-semibold text-muted">
              확인됨 · {relativeTime(alert.acknowledgedAt!)}
            </span>
          ) : null}
          <p className="mt-2 text-lg font-bold text-ink">{where}</p>
        </div>
        <span className="shrink-0 text-sm text-muted">{relativeTime(alert.createdAt)}</span>
      </div>

      <p className="text-base text-ink">{alert.message}</p>
      <p className="text-sm text-muted">{meta.action}</p>

      <div className="mt-auto flex justify-end gap-2">
        {!acknowledged ? (
          <button type="button" disabled={busy} onClick={onAcknowledge} className="btn-ghost">
            {busy ? "확인 중…" : "확인"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => navigate(`/settings/channels/${alert.sellerAccountId}`)}
          className="btn-ghost"
        >
          재연결·테스트
        </button>
      </div>
    </div>
  );
}
