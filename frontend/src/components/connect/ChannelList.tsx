import { useNavigate } from "react-router-dom";
import { channelSupportDisplay } from "../../lib/channelSupport";
import { channelCardAction, selectChannelAccount } from "../../lib/channelConnection";
import { CAFE24_CONNECT_ROUTE } from "../../lib/cafe24Connect";
import { frontendRunId, isWalkthroughMode, withWalkthroughRun } from "../../lib/guidedConnection/walkthrough";
import { relativeTime } from "../../lib/format";
import type {
  ChannelResponse,
  ConnectionStatusView,
  SellerAccountResponse,
} from "../../lib/types";
import { Btn } from "../ui/Btn";
import { Chip } from "../ui/Chip";
import { Empty } from "../ui/Empty";

/**
 * The channel list.
 *
 * WHAT IT MAY AND MAY NOT SAY. Every row is a channel the server actually returned, and every
 * support word on it comes from `channelSupportDisplay`, which turns the server's own support
 * FACTS into conservative copy. This component adds no support claim of its own: it does not
 * describe any channel as automatically connected, and it does not present the catalogue as a list
 * of things that work. The row's action is decided by `channelCardAction` from the account's real
 * connection status, so a label can never get ahead of the account behind it.
 */
function ChannelRow({
  channel,
  account,
  health,
  statusLoading,
  onNotice,
}: {
  channel: ChannelResponse;
  account: SellerAccountResponse | null;
  health: ConnectionStatusView | null;
  statusLoading: boolean;
  onNotice: (message: string) => void;
}) {
  const navigate = useNavigate();
  const canUpload =
    channel.status === "FILE_UPLOAD_SUPPORTED" || channel.actionLabel === "파일 업로드";
  const support = channelSupportDisplay(channel);
  const lastCollected = health?.lastSyncedAt ?? channel.lastSyncedAt;
  const failing = !!health && (health.consecutiveFailures > 0 || !!health.lastError);
  const action = channelCardAction(channel, account, canUpload, failing);

  // Route targets updated to the v2 IA; the decision logic itself is untouched.
  function handleAction() {
    switch (action.intent) {
      case "manage":
        if (account) {
          navigate(`/connect/channels/${account.id}`);
        }
        return;
      case "connect-cafe24":
        navigate(`${CAFE24_CONNECT_ROUTE}/tutorial`);
        return;
      case "reconnect":
        navigate(CAFE24_CONNECT_ROUTE);
        return;
      case "connect-naver":
        // Preserve the disposable walkthrough run id when one is bound to this frontend build. A bare
        // navigate("/connect/naver") would land the guided page with no `?walkthroughRun=`, which the
        // env-binding reads as `MISSING_URL_RUN` and fail-closes — the campaign's first in-app entry then
        // dead-ends at the mismatch screen. `frontendRunId()` is the build-injected id (never a guess), and
        // `withWalkthroughRun` is a no-op outside walkthrough mode, so normal sellers still get the bare path.
        navigate(withWalkthroughRun("/connect/naver", isWalkthroughMode() ? frontendRunId() : null));
        return;
      case "connect-coupang":
        // Same disposable-run preservation as NAVER: carry the bound run id into the Coupang connect page so
        // its env-binding gate reads a matching `?walkthroughRun=` instead of fail-closing on MISSING_URL_RUN.
        // No-op outside walkthrough mode, so normal sellers still get the bare `/connect/coupang`.
        navigate(withWalkthroughRun("/connect/coupang", isWalkthroughMode() ? frontendRunId() : null));
        return;
      case "upload":
        navigate(`/connect/upload?channelId=${channel.id}`);
        return;
      case "notice":
        onNotice(
          channel.support.credentialSetupSupported
            ? "이 채널은 연결 정보를 등록한 뒤 연결할 수 있습니다."
            : "이 채널은 아직 연결 방식을 확인하는 중입니다.",
        );
        return;
    }
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
      <div className="min-w-0 flex-1">
        <p className="break-keep font-semibold text-ink">{channel.nameKo}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip>{support.primaryLabel}</Chip>
          {support.chips.map((chip) => (
            <Chip key={chip}>{chip}</Chip>
          ))}
        </div>
        {support.uploadQualifier ? (
          <p className="mt-2 break-keep text-sm text-muted">{support.uploadQualifier}</p>
        ) : null}
        <p className="mt-2 text-sm text-muted">
          {lastCollected ? `마지막 수집 ${relativeTime(lastCollected)}` : "수집 이력 없음"}
        </p>
        {failing ? (
          <p className="mt-1 break-keep text-sm font-medium text-warn">
            최근 수집에서 확인이 필요한 문제가 있었습니다.
          </p>
        ) : null}
      </div>
      <Btn
        size="sm"
        variant={action.intent === "manage" ? "outline" : "solid"}
        onClick={handleAction}
        disabled={action.disabled || statusLoading}
      >
        {action.label}
      </Btn>
    </li>
  );
}

export function ChannelList({
  channels,
  accounts,
  health,
  statusLoading,
  onNotice,
}: {
  channels: readonly ChannelResponse[];
  accounts: SellerAccountResponse[] | null;
  health: Map<string, ConnectionStatusView>;
  statusLoading: boolean;
  onNotice: (message: string) => void;
}) {
  if (channels.length === 0) {
    return <Empty title="채널 정보를 불러오지 못했습니다" body="잠시 후 다시 시도해 주세요." />;
  }
  return (
    <ul aria-label="채널 목록" className="-mx-5 divide-y divide-line">
      {channels.map((channel) => {
        const account = selectChannelAccount(accounts, channel.id);
        return (
          <ChannelRow
            key={channel.id}
            channel={channel}
            account={account}
            health={account ? health.get(account.id) ?? null : null}
            statusLoading={statusLoading}
            onNotice={onNotice}
          />
        );
      })}
    </ul>
  );
}
