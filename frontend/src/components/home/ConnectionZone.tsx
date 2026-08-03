import type { ConnectionSummary } from "../../lib/homeSignals";
import { Panel } from "../ui/Panel";
import { BtnLink } from "../ui/Btn";

/**
 * Zone 3 — connections that need the seller.
 *
 * Action-needed only, by design. It never renders an all-clear: the channel read can succeed while
 * a channel is quietly stale, so "모두 정상" would be a health claim the data cannot support. It
 * also says nothing about which channels connect automatically — that judgement belongs to the
 * channel list, which derives its wording from the server's own support facts.
 */
export function ConnectionZone({ summary }: { summary: ConnectionSummary }) {
  const { needsAttention, openAlerts, nothingConnected } = summary;
  const quiet = needsAttention.length === 0 && openAlerts.length === 0;

  return (
    <Panel
      title="연결 상태"
      description="확인이 필요한 연결만 표시합니다."
      action={
        <BtnLink to="/connect" size="sm" variant="outline">
          연결 관리
        </BtnLink>
      }
    >
      {nothingConnected ? (
        <p className="break-keep leading-relaxed text-muted">
          아직 연결된 채널이 없습니다. 채널을 연결하거나 정기 자료 가져오기로 시작할 수 있습니다.
        </p>
      ) : quiet ? (
        <p className="break-keep leading-relaxed text-muted">
          지금 확인이 필요한 연결은 없습니다. 채널별 상태는 연결 관리에서 직접 확인하실 수 있습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {needsAttention.map((channel) => (
            <li
              key={channel.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas px-4 py-3"
            >
              <span className="break-keep font-medium text-ink">{channel.nameKo}</span>
              <span className="text-sm text-muted">{channel.actionLabel}</span>
            </li>
          ))}
          {openAlerts.map((alert) => (
            <li
              key={alert.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warn/10 px-4 py-3"
            >
              <span className="break-keep font-medium text-warn">{alert.message}</span>
              {alert.channelNameKo ? (
                <span className="text-sm text-warn/80">{alert.channelNameKo}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
