import { useNavigate } from "react-router-dom";
import { channelSupportDisplay } from "../../lib/channelSupport";
import { channelCardAction, selectChannelAccount } from "../../lib/channelConnection";
import { CAFE24_CONNECT_ROUTE } from "../../lib/cafe24Connect";
import { frontendRunId, isWalkthroughMode, withWalkthroughRun } from "../../lib/guidedConnection/walkthrough";
import { relativeTime } from "../../lib/format";
import { expiryNeedsAttention, shouldOfferRenewal } from "../../lib/coupangExpiry";
import { hasReviewRecord, reviewEntryLabel, reviewRecordPath } from "../../lib/reviewRecord";
import { connectionState, type ConnectionState } from "../../lib/connectionState";
import { ExpiryChip, RENEW_CTA_LABEL } from "../coupang/CoupangExpiryPanel";
import type {
  ChannelResponse,
  ConnectionStatusView,
  SellerAccountResponse,
} from "../../lib/types";
import { Btn, BtnLink } from "../ui/Btn";
import { Chip } from "../ui/Chip";
import { Status, type StatusTone } from "../ui/Status";
import { Disclosure } from "../ui/Disclosure";
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
  reviewCount,
  onNotice,
}: {
  channel: ChannelResponse;
  account: SellerAccountResponse | null;
  health: ConnectionStatusView | null;
  statusLoading: boolean;
  reviewCount: number | null;
  onNotice: (message: string) => void;
}) {
  const navigate = useNavigate();
  const canUpload =
    channel.status === "FILE_UPLOAD_SUPPORTED" || channel.actionLabel === "파일 업로드";
  const support = channelSupportDisplay(channel);
  const lastCollected = health?.lastSyncedAt ?? channel.lastSyncedAt;
  const failing = !!health && (health.consecutiveFailures > 0 || !!health.lastError);
  const action = channelCardAction(channel, account, canUpload, failing);
  // One word for how this channel stands (A5): 연결됨 · 연결 필요 · 연결 중 · 재연결 필요 · 오류.
  const state = connectionState(account, health);

  // Credential-expiry surfacing (Coupang). The backend supplies the expiry sub-view on the health read;
  // WARN_* / DATE_PASSED / EXPIRED flag "만료 예정·조치 필요", and from WARN_14 (renewRecommended) the row
  // offers the guided-renewal CTA. Absent expiry ⇒ nothing shown (channels without a token-expiry concept).
  const expiry = health?.expiry ?? null;
  const expiryFlagged = !!expiry && expiryNeedsAttention(expiry.state);
  const offerRenewal = !!account && shouldOfferRenewal(expiry);

  // The way into what this channel collected. It needs an account because the record is that
  // account's, and it needs nothing else — not a count, not a healthy connection. A seller whose
  // collection is failing still has the 상품평 gathered before it broke, and hiding the entry until
  // the numbers look right is how a working feature became invisible in the first place.
  const showReviewEntry = hasReviewRecord(channel.code) && !!account;

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
        // Unreachable for the three product channels (each has a connect flow); kept as the honest
        // answer if the catalog ever hands this list a channel without one.
        onNotice("이 채널은 지금 연결할 수 없습니다.");
        return;
    }
  }

  // ONE primary action per row (docs/reviewnary_design.md §7 채널 연결): the state decides what it is.
  // The record link is a text link; the health detail folds.
  const detailLines = [failing ? "최근 수집에서 오류가 있었습니다. 연결 관리에서 확인해 주세요." : null].filter(
    (line): line is string => !!line,
  );

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="break-keep text-base font-semibold text-ink">{channel.nameKo}</p>
          <StatePill state={state} loading={statusLoading && !!account} />
          {expiryFlagged && expiry ? (
            <span className="flex items-center gap-1.5" data-testid="channel-expiry">
              <ExpiryChip state={expiry.state} />
              <span className="text-xs font-semibold text-warn">만료 예정·조치 필요</span>
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
          {account ? null : (
            <>
              <Chip>{support.primaryLabel}</Chip>
              {support.chips.map((chip) => (
                <Chip key={chip}>{chip}</Chip>
              ))}
            </>
          )}
          <span>{lastCollected ? `마지막 수집 ${relativeTime(lastCollected)}` : "수집 이력 없음"}</span>
          {showReviewEntry && account ? (
            <BtnLink
              to={reviewRecordPath(account.id)}
              size="sm"
              variant="ghost"
              className="!min-h-0 !px-1 !py-0 text-sm !font-semibold text-brand-700"
              ariaLabel={`${channel.nameKo} ${reviewEntryLabel(reviewCount, channel.code)}`}
            >
              {reviewEntryLabel(reviewCount, channel.code)}
            </BtnLink>
          ) : null}
        </div>
        {account ? null : support.uploadQualifier ? (
          <p className="mt-1 break-keep text-sm text-muted">{support.uploadQualifier}</p>
        ) : null}
        {detailLines.length > 0 ? (
          <Disclosure label="자세히" className="mt-0.5" summaryClassName="px-0 text-xs">
            <div className="mt-1 space-y-1">
              {detailLines.map((line) => (
                <p key={line} className="break-keep text-sm text-warn">{line}</p>
              ))}
            </div>
          </Disclosure>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {offerRenewal && account ? (
          <Btn size="sm" variant="outline" onClick={() => navigate(`/connect/coupang/renew/${account.id}`)}>
            {RENEW_CTA_LABEL}
          </Btn>
        ) : null}
        <Btn
          size="sm"
          variant={action.intent === "manage" ? "outline" : "solid"}
          onClick={handleAction}
          disabled={action.disabled || statusLoading}
        >
          {action.label}
        </Btn>
      </div>
    </li>
  );
}

/** The state chip. While the account's health is still loading it says so rather than guessing 연결됨. */
function StatePill({ state, loading }: { state: ConnectionState; loading: boolean }) {
  if (loading) {
    return <Status tone="neutral">상태 확인 중</Status>;
  }
  const tone: StatusTone = state.tone === "muted" ? "neutral" : state.tone;
  return (
    <span data-testid="connection-state">
      <Status tone={tone}>{state.label}</Status>
    </span>
  );
}

export function ChannelList({
  channels,
  accounts,
  health,
  statusLoading,
  /** Collected 상품평 per account, for the rows that have a record. Absent = unknown, never zero. */
  reviewCounts,
  onNotice,
  /** True while the catalog itself is still loading (as opposed to loaded-and-empty or failed). */
  channelsLoading = false,
  /** True when the catalog read failed — the list then says so instead of rendering nothing. */
  channelsError = false,
}: {
  channels: readonly ChannelResponse[];
  accounts: SellerAccountResponse[] | null;
  health: Map<string, ConnectionStatusView>;
  statusLoading: boolean;
  reviewCounts?: Map<string, number>;
  onNotice: (message: string) => void;
  channelsLoading?: boolean;
  channelsError?: boolean;
}) {
  if (channelsLoading && channels.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted">불러오는 중…</p>;
  }
  if (channels.length === 0) {
    return channelsError ? (
      <Empty title="채널 정보를 불러오지 못했습니다" body="연결 상태를 확인한 뒤 다시 시도해 주세요." />
    ) : (
      <Empty
        title="연결할 수 있는 채널이 없습니다"
        body="네이버 스마트스토어, 쿠팡, 카페24가 표시되어야 합니다. 잠시 후 다시 시도해 주세요."
      />
    );
  }
  return (
    <ul aria-label="채널 목록" className="divide-y divide-line/70">
      {channels.map((channel) => {
        const account = selectChannelAccount(accounts, channel.id);
        return (
          <ChannelRow
            key={channel.id}
            channel={channel}
            account={account}
            health={account ? health.get(account.id) ?? null : null}
            statusLoading={statusLoading}
            reviewCount={account ? reviewCounts?.get(account.id) ?? null : null}
            onNotice={onNotice}
          />
        );
      })}
    </ul>
  );
}
