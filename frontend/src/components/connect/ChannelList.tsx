import { useNavigate } from "react-router-dom";
import { channelSupportDisplay } from "../../lib/channelSupport";
import { channelCardAction, selectChannelAccount } from "../../lib/channelConnection";
import { CAFE24_CONNECT_ROUTE } from "../../lib/cafe24Connect";
import { frontendRunId, isWalkthroughMode, withWalkthroughRun } from "../../lib/guidedConnection/walkthrough";
import { relativeTime } from "../../lib/format";
import { expiryNeedsAttention, shouldOfferRenewal } from "../../lib/coupangExpiry";
import { hasReviewRecord, reviewEntryLabel, reviewRecordPath } from "../../lib/reviewRecord";
import { ExpiryChip, RENEW_CTA_LABEL } from "../coupang/CoupangExpiryPanel";
import type {
  ChannelResponse,
  ConnectionStatusView,
  SellerAccountResponse,
} from "../../lib/types";
import { Btn, BtnLink } from "../ui/Btn";
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
        {expiryFlagged && expiry ? (
          <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="channel-expiry">
            <ExpiryChip state={expiry.state} />
            <span className="break-keep text-sm font-medium text-warn">만료 예정·조치 필요</span>
          </div>
        ) : null}
        {offerRenewal && account ? (
          <Btn
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => navigate(`/connect/coupang/renew/${account.id}`)}
          >
            {RENEW_CTA_LABEL}
          </Btn>
        ) : null}
      </div>
      {/*
        Two actions at most, and they wrap rather than compete: on a narrow screen the row's text
        column takes the full width and these fall underneath it, still at full size. Nothing here
        collapses into an overflow menu — an entry point a seller has already failed to find twice
        does not get hidden behind another press.

        The 상품평 entry is the loud one on a healthy row, because the record is where the seller is
        going and the connection is only how it got there. When collection is failing that ordering
        inverts: the row is asking to be repaired, and a bright button pointing away from the repair
        would be the wrong invitation.
      */}
      <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
        {showReviewEntry && account ? (
          <BtnLink
            to={reviewRecordPath(account.id)}
            size="sm"
            variant={failing ? "outline" : "solid"}
            // On screen the row's heading says which channel this is; in a screen reader's link list
            // it does not, and a page of rows would offer several links differing only by a number.
            ariaLabel={`${channel.nameKo} ${reviewEntryLabel(reviewCount)}`}
          >
            {reviewEntryLabel(reviewCount)}
          </BtnLink>
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

export function ChannelList({
  channels,
  accounts,
  health,
  statusLoading,
  /** Collected 상품평 per account, for the rows that have a record. Absent = unknown, never zero. */
  reviewCounts,
  onNotice,
}: {
  channels: readonly ChannelResponse[];
  accounts: SellerAccountResponse[] | null;
  health: Map<string, ConnectionStatusView>;
  statusLoading: boolean;
  reviewCounts?: Map<string, number>;
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
            reviewCount={account ? reviewCounts?.get(account.id) ?? null : null}
            onNotice={onNotice}
          />
        );
      })}
    </ul>
  );
}
