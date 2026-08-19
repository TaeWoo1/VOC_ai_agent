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
export const AW_CARRIER_KINDS = ["export", "reply", "import", "issuance", "locate", "renewal"] as const;

export type AwCarrierKind = (typeof AW_CARRIER_KINDS)[number];

/**
 * The v1 export Action Window carrier — the acquisition/export run world.
 *
 * <p>Deliberately UNANNOTATED so it keeps its literal type. Written
 * {@code const AW_CARRIER_EXPORT: AwCarrierKind = "export"} the annotation widens it to the union,
 * and an announcement field typed {@code typeof AW_CARRIER_EXPORT} would then accept
 * {@code "reply"} — which is exactly the mistake this whole field exists to make impossible.
 */
export const AW_CARRIER_EXPORT = "export";

/** The v2 reply-submission carrier. Unannotated for the same reason as {@link AW_CARRIER_EXPORT}. */
export const AW_CARRIER_REPLY = "reply";

/**
 * The v2 **initial-review-import** carrier — the onboarding historical-backfill world.
 *
 * <p>Like `reply`, it speaks v2 envelopes, so version alone cannot separate the two: a client attaching
 * to an import agent while expecting reply-submission runs would build a correctly-versioned client and
 * then sit dormant, which is precisely the failure this field exists to make impossible. An import run
 * is also read-only export choreography (guide → operator clicks → download → ingest), NOT a
 * marketplace-mutating post, so collapsing it into `reply` would misdescribe what the agent does.
 *
 * <p>Unannotated for the same reason as {@link AW_CARRIER_EXPORT}.
 */
export const AW_CARRIER_IMPORT = "import";

/**
 * The v2 **API-issuance guidance** carrier — the NAVER Commerce API-center onboarding world.
 *
 * <p>It speaks v2 envelopes like `reply` and `import`, so version alone cannot separate the three: a
 * client attaching to an issuance agent while expecting one of the others would build a correctly-versioned
 * client and then sit dormant — the failure this field exists to make impossible. An issuance run is
 * read-only guidance choreography over the API center (open → observe page category → highlight the
 * control the seller must press → observe the seller's own click → advance), reaching the ordinary
 * `COMPLETED` terminal. It NEVER logs in, clicks, submits, auto-creates an application, selects an API
 * group, or reads the Application ID / Secret; the seller performs every real step and copies the
 * credential into SellerOps's own masked form themselves. Collapsing it into `import` would misdescribe
 * what the agent does — an import downloads and ingests a file; issuance touches nothing and produces no
 * artifact.
 *
 * <p>Unannotated for the same reason as {@link AW_CARRIER_EXPORT}.
 */
export const AW_CARRIER_ISSUANCE = "issuance";

/**
 * The v2 **review-locate** carrier — showing a seller, on the marketplace's own screen, one review SellerOps
 * has already stored.
 *
 * <p>It speaks v2 envelopes like `reply`, `import` and `issuance`, so version alone cannot separate the four.
 * It is its own kind because what the agent does here is narrower than all three: a locate run reads the page
 * the seller brought up and draws a ring around one row. It downloads nothing, ingests nothing, submits
 * nothing, and guides no walk — folding it into `issuance` would announce a multi-step tutorial where there is
 * a single read, and folding it into `export` would announce an artifact that never exists.
 *
 * <p>Unannotated for the same reason as {@link AW_CARRIER_EXPORT}.
 */
export const AW_CARRIER_LOCATE = "locate";

/**
 * The v2 **credential-RENEWAL guidance** carrier — walking a seller whose Coupang Open API key is expiring
 * through re-issuing it at WING.
 *
 * <p>It speaks v2 envelopes like `reply`, `import`, `issuance` and `locate`, so version alone cannot separate
 * the five. It is its OWN kind rather than a second channel of `issuance`, and the reason is a defect this
 * field exists to make impossible: the renewal screen used to ask for `issuance`/`coupang` — byte-identical to
 * what the FIRST-TIME walk asks for — so the resident helper answered with the eight-step NEW-KEY engine while
 * the page rendered 갱신 copy, and every step arrived under a `actionWindow.coupangIssuance.*` key the renewal
 * screen has no mapping for (it rendered no detail at all). Two different choreographies over the same
 * (carrier, channel) pair is exactly the mis-attach `parseAwCarrierKind`'s docblock describes, one level up.
 *
 * <p>The choreographies really are different: issuance is eight steps ending in a key that did not exist
 * before; renewal is five (`reach open API → check 유효기간 → press 재발급 → copy the new keys → return`), it
 * begins from a key that already exists, and its whole point is the expiry date. Renewal also has the one
 * value read no other guidance carrier has — the 유효기간 DATE, through an allowlisted seam — while still
 * never reading an Access Key, a Secret Key, or a 업체코드.
 *
 * <p>Like every other guidance carrier it NEVER logs in, clicks, types, submits, or re-issues: the seller
 * presses `재발급` themselves and SellerOps highlights and observes. READ-only, so the WRITE boundary is
 * untouched.
 *
 * <p>Unannotated for the same reason as {@link AW_CARRIER_EXPORT}.
 */
export const AW_CARRIER_RENEWAL = "renewal";


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
