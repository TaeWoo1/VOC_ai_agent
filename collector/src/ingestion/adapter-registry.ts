/**
 * **Producer adapter registry** (pure, offline, channel-neutral).
 *
 * The single policy mapping `sourceAdapter.name + version → allowed channel`. The Cloud consumer validates
 * every envelope's declared `sourceAdapter` against this registry — it does NOT trust the adapter's own
 * channel claim, and it does NOT depend on any producer's capture type. Adding a producer (NAVER / Cafe24)
 * is a registry entry, not a workflow change.
 */

import type { CommerceChannel } from "../connection/sync-state";
import type { SourceAdapterRef } from "./envelope";

/** A registered producer adapter: its name, the versions this build accepts, and the channel it may produce. */
export interface RegisteredAdapter {
  name: string;
  versions: readonly string[];
  channel: CommerceChannel;
}

/** The channel-neutral registry. The ESM inquiry producer is the first (and only) registered adapter today. */
export const INQUIRY_ADAPTER_REGISTRY: readonly RegisteredAdapter[] = [
  { name: "esm-inquiry", versions: ["0.1.0"], channel: "ESM" },
];

const BY_NAME: ReadonlyMap<string, RegisteredAdapter> = new Map(INQUIRY_ADAPTER_REGISTRY.map((a) => [a.name, a]));

/** Why an adapter descriptor failed registry validation. */
export type AdapterRejectReason = "UNKNOWN_ADAPTER" | "UNSUPPORTED_ADAPTER_VERSION" | "ADAPTER_CHANNEL_MISMATCH";

export type AdapterCheck = { ok: true } | { ok: false; reason: AdapterRejectReason };

/**
 * Validate a declared adapter descriptor against the registry for the envelope's channel. Rejects an unknown
 * name, an unsupported version, and a registry channel that disagrees with the envelope channel — the last of
 * which catches a self-consistent-but-false claim (adapter says NAVER, envelope says NAVER, but the registry
 * registered that adapter for ESM). Blank adapter fields are caught earlier by envelope validation.
 */
export function checkAdapter(adapter: SourceAdapterRef, envelopeChannel: CommerceChannel): AdapterCheck {
  const registered = BY_NAME.get(adapter.name);
  if (registered === undefined) return { ok: false, reason: "UNKNOWN_ADAPTER" };
  if (!registered.versions.includes(adapter.version)) return { ok: false, reason: "UNSUPPORTED_ADAPTER_VERSION" };
  // The registry is authoritative for the channel — the adapter's own `channel` claim is not trusted.
  if (registered.channel !== envelopeChannel) return { ok: false, reason: "ADAPTER_CHANNEL_MISMATCH" };
  return { ok: true };
}
