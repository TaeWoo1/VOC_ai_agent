/**
 * Deterministic, sanitized attention digest over a batch of `SellerOpsEvent[]`.
 *
 * This is the first batch-level layer for the product view: "what kinds of attention
 * signals are accumulating today?". It is a pure rollup of the existing deterministic
 * attention signals + sanitized summaries — NOT a numeric score, NOT a ranking, NOT
 * AI, NOT live collection.
 *
 * It reads only `attentionSignalsFor` (which itself reads only sanitized summaries)
 * and the sanitized summary's coarse `kind` / `platform` / `channel`. It therefore
 * cannot expose event ids, reference codes, raw content, exact amounts/counts, or
 * identity. No I/O, no network, no fs, no browser, no env, no AI.
 */

import { attentionSignalsFor } from "./attention-signals";
import type { AttentionSignalCode, AttentionSignalSeverity } from "./attention-signals";
import { sanitizedSummaryFor } from "./sanitized-summary";
import type { SellerOpsEvent, SellerOpsEventKind } from "./types";

export interface AttentionSignalCount {
  code: AttentionSignalCode;
  count: number;
}

export interface AttentionSeverityCount {
  severity: AttentionSignalSeverity;
  count: number;
}

export interface AttentionKindCount {
  kind: SellerOpsEventKind;
  count: number;
}

export interface AttentionChannelCount {
  channel: string;
  count: number;
}

export interface AttentionPlatformCount {
  platform: string;
  count: number;
}

export interface AttentionDigest {
  totalEvents: number;
  totalSignals: number;
  bySignalCode: AttentionSignalCount[];
  bySeverity: AttentionSeverityCount[];
  byEventKind: AttentionKindCount[];
  byPlatform: AttentionPlatformCount[];
  byChannel: AttentionChannelCount[];
}

/** Fixed signal-code order — mirrors the declared `AttentionSignalCode` order. */
const CODE_ORDER: readonly AttentionSignalCode[] = [
  "low_rating_review",
  "not_replied_review",
  "unanswered_inquiry",
  "active_claim",
  "sales_context_available",
  "high_sales_context",
  "unknown_attention_signal",
];

/** Fixed severity order: high → medium → low. */
const SEVERITY_ORDER: readonly AttentionSignalSeverity[] = ["high", "medium", "low"];

/** Fixed event-kind order for the digest. */
const KIND_ORDER: readonly SellerOpsEventKind[] = [
  "review",
  "cs_inquiry",
  "claim",
  "order_shipping",
  "sales_context",
];

function inc<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Roll up a batch of events into a sanitized digest. Signal-level counts come from
 * `attentionSignalsFor`; event-level counts (kind/platform/channel) come from the
 * sanitized summary. Ordering is deterministic: declared order for codes/severities/
 * kinds, lexicographic for platforms/channels. Empty input → zero counts, empty
 * arrays. No deduplication in this slice (see attention-digest-model.md — future work).
 */
export function attentionDigest(events: SellerOpsEvent[]): AttentionDigest {
  const codeCounts = new Map<AttentionSignalCode, number>();
  const severityCounts = new Map<AttentionSignalSeverity, number>();
  const kindCounts = new Map<SellerOpsEventKind, number>();
  const platformCounts = new Map<string, number>();
  const channelCounts = new Map<string, number>();
  let totalSignals = 0;

  for (const event of events) {
    const summary = sanitizedSummaryFor(event);
    inc(kindCounts, summary.kind);
    inc(platformCounts, summary.platform);
    inc(channelCounts, summary.channel);
    for (const signal of attentionSignalsFor(event)) {
      totalSignals += 1;
      inc(codeCounts, signal.code);
      inc(severityCounts, signal.severity);
    }
  }

  return {
    totalEvents: events.length,
    totalSignals,
    bySignalCode: CODE_ORDER.filter((c) => codeCounts.has(c)).map((code) => ({
      code,
      count: codeCounts.get(code) ?? 0,
    })),
    bySeverity: SEVERITY_ORDER.filter((s) => severityCounts.has(s)).map((severity) => ({
      severity,
      count: severityCounts.get(severity) ?? 0,
    })),
    byEventKind: KIND_ORDER.filter((k) => kindCounts.has(k)).map((kind) => ({
      kind,
      count: kindCounts.get(kind) ?? 0,
    })),
    byPlatform: [...platformCounts.keys()].sort().map((platform) => ({
      platform,
      count: platformCounts.get(platform) ?? 0,
    })),
    byChannel: [...channelCounts.keys()].sort().map((channel) => ({
      channel,
      count: channelCounts.get(channel) ?? 0,
    })),
  };
}
