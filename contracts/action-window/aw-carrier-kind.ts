/**
 * **Which Action Window carrier an agent hosts**, announced in `aw_session`.
 *
 * Deliberately OUTSIDE `v1/` and `v2/`: it is the field that tells a client which of those two to
 * use, so it cannot live inside either without the client having to already know the answer in order
 * to read it. Both endpoints import it, and so does the frontend.
 *
 * ## Why this exists
 *
 * The two carriers are byte-for-byte identical at the transport layer — same `/bridge/ws` socket,
 * same `{type:"aw", payload}` framing, same `aw_session` shape — because the Bridge treats the
 * payload as opaque and never inspects it. They differ only in the contract version of what is
 * inside that payload (v1 export envelopes vs v2 reply-submission envelopes).
 *
 * That left a client with **nothing to discriminate on**:
 *
 * - `transportVersion` is `1` in BOTH (`contracts/action-window/v{1,2}/transport.ts`) — correctly so,
 *   since it versions the CARRIER framing, which really is identical;
 * - `channelCode` is `naver` on both;
 * - and `runId` is opaque by design.
 *
 * So a frontend attaching to an agent hosting the reply carrier would accept the announcement, build
 * a v1 client, and feed v2 envelopes into it — landing "connected but dormant" instead of failing
 * closed. This field makes the difference statable.
 *
 * ## What it is not
 *
 * Not a capability negotiation and not a version. An agent hosts exactly ONE carrier
 * (`createAgentBridge` throws when both are configured), so this reports a fact about the agent, not
 * a menu to choose from.
 */
export const AW_CARRIER_KINDS = ["export", "reply"] as const;

export type AwCarrierKind = (typeof AW_CARRIER_KINDS)[number];

/** The v1 export Action Window carrier — the acquisition/export run world. */
export const AW_CARRIER_EXPORT: AwCarrierKind = "export";

/** The v2 reply-submission carrier — the isolated guided-reply world. */
export const AW_CARRIER_REPLY: AwCarrierKind = "reply";

/**
 * Narrow an announced value to a known carrier, or `null` when it is absent or unrecognised.
 *
 * <p>**Absence is not "export".** Both endpoints predate this field, so an announcement without it
 * could have come from either — it is genuinely ambiguous, and resolving ambiguity by assuming the
 * happy case is how the mis-attach this field prevents would come back. A client that cannot tell
 * which carrier it is talking to must decline to attach.
 */
export function parseAwCarrierKind(value: unknown): AwCarrierKind | null {
  return typeof value === "string" && (AW_CARRIER_KINDS as readonly string[]).includes(value)
    ? (value as AwCarrierKind)
    : null;
}
