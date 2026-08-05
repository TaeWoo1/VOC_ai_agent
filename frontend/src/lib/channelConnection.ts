// Pure helpers deciding a channel card's primary action from the REAL SellerAccount
// connection state (SellerAccountResponse.connectionStatus) — never inferred from
// channel capabilities or collection history. Kept DOM-free so the mapping is
// unit-tested in the repo's node-environment Vitest setup.
import type { ChannelResponse, ChannelStatus, SellerAccountResponse } from "./types";

/** What the card's primary button does when clicked. */
export type ChannelCardIntent =
  | "manage" // open the connected account's detail
  | "reconnect" // Cafe24: (re-)run the OAuth flow, reusing the existing account
  | "connect-cafe24" // no account yet: start the Cafe24 OAuth flow
  | "connect-naver" // no account yet: start the NAVER guided-connection wizard (/connect/naver)
  | "connect-coupang" // no account yet: open the Coupang connection setup (/connect/coupang)
  | "upload" // file-upload channel
  | "notice"; // no auto-connect path: show a guidance notice

export interface ChannelCardAction {
  label: string;
  intent: ChannelCardIntent;
  disabled: boolean;
}

/**
 * The one API-mode (non-file-upload) seller account for a channel, or null. The
 * backend upserts a single account per (org, channel); if the list ever carries more
 * than one row for a channel (e.g. a legacy file-upload row alongside an API row) the
 * file-upload rows are ignored and the first API-mode row is chosen deterministically.
 */
export function selectChannelAccount(
  accounts: SellerAccountResponse[] | null,
  channelId: string,
): SellerAccountResponse | null {
  const apiAccounts = (accounts ?? []).filter(
    (a) => a.channelId === channelId && !a.fileUpload,
  );
  return apiAccounts[0] ?? null;
}

/**
 * Decide the card's primary action from the account's real connection status. The
 * OAuth states drive the label; a CONNECTED account falls through to the existing
 * presence/collection-health affordance. Capability descriptions stay separate.
 */
export function channelCardAction(
  channel: Pick<ChannelResponse, "code" | "status" | "actionLabel">,
  account: SellerAccountResponse | null,
  canUpload: boolean,
  collectionFailing: boolean,
): ChannelCardAction {
  if (account) {
    const status: ChannelStatus = account.connectionStatus;
    if (status === "PENDING") {
      // Connect started but not finished (e.g. the OAuth attempt expired). Keep the
      // button enabled so the seller can resume through the normal flow; the backend
      // start() reuses this account and supersedes the stale OAuth state — no new
      // account, no separate resume endpoint.
      return {
        label: "연결 계속하기",
        intent: channel.code === "CAFE24" ? "reconnect" : "manage",
        disabled: false,
      };
    }
    if (status === "RECONNECT_REQUIRED") {
      return {
        label: "다시 연결하기",
        intent: channel.code === "CAFE24" ? "reconnect" : "manage",
        disabled: false,
      };
    }
    // CONNECTED (or any other settled state with an account): manage it. A connected
    // account whose collection is failing keeps the existing re-run affordance.
    return {
      label: collectionFailing ? "재연결·테스트" : "연결 관리",
      intent: "manage",
      disabled: false,
    };
  }

  // No account yet.
  const prepping = channel.status === "PREPARING";
  if (channel.code === "CAFE24") {
    return { label: channel.actionLabel, intent: "connect-cafe24", disabled: prepping };
  }
  if (channel.code === "NAVER") {
    // First-time NAVER: the guided-connection wizard (§16.10) is the primary path — it connects
    // orders via the official API and hands off to Action Window review export. Upload stays
    // reachable from the channel detail.
    return { label: channel.actionLabel, intent: "connect-naver", disabled: prepping };
  }
  if (channel.code === "COUPANG") {
    // First-time Coupang: the connection setup surface shows the official prerequisites (issue the WING
    // API key, grant order-API access, register the deployment calling IP) then hosts credential entry +
    // the connection test. Orders connect via the official Coupang Open API.
    return { label: channel.actionLabel, intent: "connect-coupang", disabled: prepping };
  }
  if (canUpload) {
    return { label: channel.actionLabel, intent: "upload", disabled: false };
  }
  return { label: channel.actionLabel, intent: "notice", disabled: prepping };
}
