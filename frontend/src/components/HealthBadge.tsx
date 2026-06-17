/** Connection health pill for a seller account, driven by
 *  ConnectionStatusView.state. Shared by the /channels overview and the
 *  ChannelDetail page so health renders identically in both places. Covers every
 *  backend state (channel_connection_status): CONNECTED / DEGRADED / EXPIRED /
 *  NEEDS_REAUTH / DISCONNECTED / NOT_COLLECTED. */
const HEALTH_MAP: Record<string, { label: string; cls: string }> = {
  CONNECTED: { label: "정상 수집 중", cls: "bg-good/10 text-good" },
  DEGRADED: { label: "점검 필요", cls: "bg-warn/10 text-warn" },
  EXPIRED: { label: "인증 만료", cls: "bg-bad/10 text-bad" },
  NEEDS_REAUTH: { label: "재인증 필요", cls: "bg-bad/10 text-bad" },
  DISCONNECTED: { label: "연결 끊김", cls: "bg-bad/10 text-bad" },
  NOT_COLLECTED: { label: "수집 이력 없음", cls: "bg-ink/5 text-muted" },
};

export function HealthBadge({ state }: { state: string }) {
  const { label, cls } = HEALTH_MAP[state] ?? { label: state, cls: "bg-ink/5 text-muted" };
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${cls}`}>
      {label}
    </span>
  );
}
