// Pure derivation for the operations home. No React, no I/O.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a count is only shown when it was computed from data that
// actually loaded. When a read fails there is no number — there is an unavailable state. "0건"
// rendered because a request failed is the worst possible lie on this screen: it reads as "nothing
// needs you today" and the seller stops looking.

// The three Today items (리뷰 · 문의 · 연결) live in `todayInbox.ts`; this file keeps the shared
// signal vocabulary, the recurring-issue signal and the connection summary.

import type { ChannelResponse, ConnectorAlertView } from "./types";

/** A number the screen is allowed to show, or an honest absence. */
export type Signal =
  /** Loaded. `count` may legitimately be 0. */
  | { kind: "READY"; count: number }
  /** Nothing is connected yet — the surface has never had data to hold. */
  | { kind: "NOT_CONNECTED" }
  /** The read failed. Deliberately NOT rendered as 0. */
  | { kind: "UNAVAILABLE" };

export interface AttentionCard {
  id: string;
  label: string;
  /** Where the operator goes to act on it. */
  to: string;
  signal: Signal;
  /** Wording shown instead of a number when the signal is not READY. */
  hint: string;
}

const NOT_CONNECTED_HINT = "자료를 연결하면 표시됩니다";
const UNAVAILABLE_HINT = "지금은 확인할 수 없습니다";

export function hintFor(signal: Signal): string | null {
  switch (signal.kind) {
    case "NOT_CONNECTED":
      return NOT_CONNECTED_HINT;
    case "UNAVAILABLE":
      return UNAVAILABLE_HINT;
    default:
      return null;
  }
}

/**
 * Recurring-issue candidates.
 *
 * Kept separate from the inbox cards because it has its own source and its own failure: the review
 * issue read is strict and does not fall back to seeded data, so a demo environment reports
 * UNAVAILABLE here rather than showing invented issues.
 */
export function buildIssueAttention(issueCount: number | null, loaded: boolean): AttentionCard {
  let signal: Signal;
  if (!loaded) {
    signal = { kind: "UNAVAILABLE" };
  } else if (issueCount === null) {
    signal = { kind: "UNAVAILABLE" };
  } else {
    signal = { kind: "READY", count: issueCount };
  }
  return {
    id: "recurring-issues",
    label: "반복되는 고객 문제",
    to: "/memory",
    signal,
    hint: hintFor(signal) ?? "",
  };
}

export interface ConnectionSummary {
  /** Channels whose own status says they need the seller. */
  needsAttention: ChannelResponse[];
  /** Unacknowledged connection alerts. */
  openAlerts: ConnectorAlertView[];
  /** True when nothing has ever been connected. */
  nothingConnected: boolean;
}

/**
 * Channel statuses that mean "a person has to do something here".
 *
 * Only the two states that describe an interrupted connection. `AVAILABLE`, `PREPARING` and
 * `REQUEST_AVAILABLE` describe what the product can offer, not something the seller has to fix —
 * listing them here would fill the zone with rows nobody can act on.
 */
const ATTENTION_STATUSES = new Set<ChannelResponse["status"]>([
  "RECONNECT_REQUIRED",
  "PENDING",
]);

/**
 * Connection zone input.
 *
 * Reports only what needs a person. It never renders a "정상" roll-up: `channels` can succeed while
 * a channel is quietly stale, so an all-clear here would be a health claim the data does not
 * support.
 */
export function summarizeConnections(
  channels: readonly ChannelResponse[] | null,
  alerts: readonly ConnectorAlertView[] | null,
): ConnectionSummary {
  const list = channels ?? [];
  return {
    needsAttention: list.filter((channel) => ATTENTION_STATUSES.has(channel.status)),
    openAlerts: (alerts ?? []).filter((alert) => alert.acknowledgedAt == null),
    nothingConnected: channels !== null && list.length === 0,
  };
}
