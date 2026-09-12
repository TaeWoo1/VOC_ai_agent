/**
 * Channel capability reasoning — what a channel can actually DO, resolved from the backend's own
 * registries, so the seller never has to know that NAVER, Coupang and Cafe24 differ.
 *
 * <b>A pure function over sources the tool read; no registry of its own.</b> The sources are the
 * three backend answers that already exist (`/capabilities/overview`, `/inquiry-publish/transports`
 * + `/capability`, the review channel capability block) and one hint the frontend sends (whether a
 * local agent is paired). Nothing here reads a sentence: the channel, the data type, the object kind
 * and the source subtype are closed tokens the caller already holds. Where a source is absent (a
 * backend predating an endpoint), the answer degrades to the fail-closed value, never to a guess.
 *
 * <b>Acquisition ≠ freshness.</b> This file says HOW a channel's rows can be refreshed; whether the
 * stored rows are current enough for a question is `graph/reviewRows.ts`'s `freshnessVerdict`. The
 * two are joined by a decision table there, not here.
 *
 * <b>Execution ≠ identity.</b> `execution` is the channel's capability; whether a PARTICULAR object
 * may be sent is its `executableIdentity`, decided by the backend from stored provenance. A channel
 * that can execute and an object that cannot be executed on are both true at once.
 */
import type {
  AcquisitionCapability, ExecutionCapability, HumanActionPath,
} from "../../conversation/contract";
import type {
  ChannelCapabilityOverview, InquiryReplyTransportRow, PublishCapabilityView, ReviewChannelCapabilityView,
} from "../../spring/types";

/** What the frontend knows about the paired local agent (`ai.sellerops.local-agent`). Closed. */
export type LocalAgentHint = "PAIRED" | "ABSENT" | "UNKNOWN";

export type CapabilityDataType = "REVIEW" | "INQUIRY" | "ORDER_SUMMARY" | "PRODUCT";

/**
 * <b>How strongly this deployment can claim a channel serves a data type.</b>
 *
 * Four values because two sources answer the question and they disagree today (Product Self-Knowledge
 * Truth Closure v1 §9): the live connector (`overview.dataTypes[].supported` / `verificationStatus`)
 * and the reference table (`declaredSupport`). Where they differ the answer is `PARTIAL`, never the
 * stronger of the two — picking the stronger states a capability nobody proved, and picking the weaker
 * erases rows the product is holding. `UNKNOWN` is for a question nobody answered at all: no row, or
 * a backend that does not serve the field.
 */
export type SupportLevel = "SUPPORTED" | "PARTIAL" | "NOT_SUPPORTED" | "UNKNOWN";

/** Why a support level is not `SUPPORTED`. Closed, diagnostic — never rendered to a seller verbatim. */
export const SUPPORT_REASON = {
  /** Live connector and reference table disagree. */
  SOURCE_DIVERGENCE: "SOURCE_DIVERGENCE",
  /** Both agree it is served, but nobody has proven the wire shape live. */
  NEEDS_VERIFICATION: "NEEDS_VERIFICATION",
  /** No API, but a seller-completable acquisition path exists. */
  NON_API_PATH_ONLY: "NON_API_PATH_ONLY",
  /** The channel offers no path of any kind for this type. */
  NO_PATH: "NO_PATH",
  /** Nobody answered — no row, or the field is absent. */
  UNREAD: "UNREAD",
} as const;

export interface SupportVerdict {
  readonly support: SupportLevel;
  readonly reason: string | null;
  /** Kept for the diagnostic log; both words, so a divergence can be read back without a second call. */
  readonly live: "SUPPORTED" | "UNSUPPORTED" | "UNREAD";
  readonly declared: "SUPPORTED" | "UNSUPPORTED" | "UNDECLARED";
}

/** Everything the resolver may look at. Every field nullable: an absent source is a fact, not an error. */
export interface ChannelCapabilitySources {
  readonly overview: ChannelCapabilityOverview | null;
  readonly transports: readonly InquiryReplyTransportRow[] | null;
  readonly publish: PublishCapabilityView | null;
  readonly reviewChannel: ReviewChannelCapabilityView | null;
  readonly localAgent: LocalAgentHint;
}

export type GuidedPath = Extract<HumanActionPath, "EXPORT_ACTION_WINDOW" | "WING_READ_ACTION_WINDOW" | "FILE_UPLOAD">;

export interface AcquisitionVerdict {
  readonly acquisition: AcquisitionCapability;
  /** The guided path, when acquisition is GUIDED_HUMAN_ACTION. */
  readonly guidedPath: GuidedPath | null;
  /** Whether the guided path needs the paired local agent. */
  readonly requiresLocalAgent: boolean;
  /** The seller's explicit fallback when the guided path is unavailable — never the default. */
  readonly fallback: { readonly path: GuidedPath; readonly to: string; readonly label: string } | null;
  readonly acquisitionEvidence: { readonly verification: string; readonly source: string };
}

export interface ExecutionVerdict {
  readonly execution: ExecutionCapability;
  /** Closed reason when NOT_SUPPORTED — the transport's own word, or the deployment's. */
  readonly reason: string | null;
  /** Seller-facing sentence for NOT_SUPPORTED, from the audited row when it has one. */
  readonly reasonKo: string | null;
  readonly executionEvidence: { readonly verification: string; readonly source: string };
}

/** Closed reasons the resolver itself can produce (the transports carry their own `reasonKo`). */
export const EXECUTION_REASON = {
  /** The audited transport is DIRECT_API but this deployment has not enabled/registered it. */
  EXECUTION_DISABLED: "EXECUTION_DISABLED",
  /** The channel offers no reply flow for this object. */
  CHANNEL_UNSUPPORTED: "CHANNEL_UNSUPPORTED",
  /** No source answered — fail closed. */
  CAPABILITY_UNKNOWN: "CAPABILITY_UNKNOWN",
} as const;

const FILE_UPLOAD_FALLBACK = { path: "FILE_UPLOAD" as const, to: "/connect/upload", label: "파일로 직접 올리기" };

/**
 * The channel-keyed guided path, used ONLY when the overview names a guided method for the type.
 *
 * A closed table, not a router: the overview says "this type reaches us by EXPORT / ACTION_WINDOW";
 * which reviewnary-guided flow implements that method on which channel is a fact about the product's
 * own carriers (`contracts/action-window/v2`: NAVER `EXPORT`, Coupang `REVIEW_ACQUISITION`).
 */
const GUIDED_PATH_OF: Readonly<Record<string, GuidedPath>> = {
  "NAVER:EXPORT": "EXPORT_ACTION_WINDOW",
  "COUPANG:ACTION_WINDOW": "WING_READ_ACTION_WINDOW",
};

/**
 * The capability row for a data type, wherever the overview keeps it.
 *
 * PRODUCT lives in `backgroundDataTypes` rather than in the operator badge row (the backend's own
 * split, so a screen nobody asked to change does not change). One lookup so no caller has to know
 * which list a type is in — and `null` when neither answered, which is UNKNOWN, not unsupported.
 */
export function capabilityRowOf(dataType: CapabilityDataType, sources: ChannelCapabilitySources) {
  const inMain = sources.overview?.dataTypes.find((d) => d.dataType.toUpperCase() === dataType) ?? null;
  if (inMain) return inMain;
  return sources.overview?.backgroundDataTypes?.find((d) => d.dataType.toUpperCase() === dataType) ?? null;
}

/**
 * <b>How strongly this channel can be said to serve this data type — the two sources, read together.</b>
 *
 * The rule is «never the stronger of two disagreeing sources» (§9). Coupang PRODUCT is CONFIRMED in the
 * reference table and NEEDS_VERIFICATION in the connector; Coupang INQUIRY is the other way round. Both
 * come back `PARTIAL` with `SOURCE_DIVERGENCE`, and the seller-facing sentence for PARTIAL says the
 * range is not fully confirmed rather than choosing a side.
 *
 * A type with no API but a proven seller-completable path (NAVER/Coupang REVIEW) is `PARTIAL` too, for
 * a different recorded reason: it IS collected, and calling it NOT_SUPPORTED erases the rows.
 */
export function supportOf(
  channelCode: string, dataType: CapabilityDataType, sources: ChannelCapabilitySources,
): SupportVerdict {
  const row = capabilityRowOf(dataType, sources);
  const declared = ((row?.declaredSupport ?? "UNDECLARED").toUpperCase() === "SUPPORTED"
    ? "SUPPORTED"
    : (row?.declaredSupport ?? "").toUpperCase() === "UNSUPPORTED" ? "UNSUPPORTED" : "UNDECLARED") as
    SupportVerdict["declared"];
  if (!row) {
    return { support: "UNKNOWN", reason: SUPPORT_REASON.UNREAD, live: "UNREAD", declared };
  }
  const live: SupportVerdict["live"] = row.supported ? "SUPPORTED" : "UNSUPPORTED";
  const diverges = declared !== "UNDECLARED" && declared !== live;
  if (diverges) {
    return { support: "PARTIAL", reason: SUPPORT_REASON.SOURCE_DIVERGENCE, live, declared };
  }
  if (row.supported) {
    // The two sources diverge on the VERIFICATION word independently of the boolean — Coupang INQUIRY
    // is supported in both while the table still says NEEDS_VERIFICATION and the connector says
    // CONFIRMED, because a live proof promoted one and not the other. Taking the connector's word here
    // is picking the stronger of two disagreeing sources, which is the thing §9 forbids.
    const liveConfirmed = (row.verificationStatus ?? "").toUpperCase() === "CONFIRMED";
    const declaredWord = (row.declaredVerificationStatus ?? "").toUpperCase();
    const declaredConfirmed = declaredWord.length === 0 || declaredWord === "CONFIRMED";
    if (liveConfirmed && declaredConfirmed) {
      return { support: "SUPPORTED", reason: null, live, declared };
    }
    return {
      support: "PARTIAL",
      reason: liveConfirmed === declaredConfirmed
        ? SUPPORT_REASON.NEEDS_VERIFICATION
        : SUPPORT_REASON.SOURCE_DIVERGENCE,
      live, declared,
    };
  }
  // Not served by the connector — but a registered non-API path is still a way this type arrives.
  return (row.acquisitionPaths ?? []).length > 0
    ? { support: "PARTIAL", reason: SUPPORT_REASON.NON_API_PATH_ONLY, live, declared }
    : { support: "NOT_SUPPORTED", reason: SUPPORT_REASON.NO_PATH, live, declared };
}

export function acquisitionOf(channelCode: string, dataType: CapabilityDataType, sources: ChannelCapabilitySources): AcquisitionVerdict {
  const code = channelCode.toUpperCase();
  const row = capabilityRowOf(dataType, sources);
  const none = (verification: string, source: string): AcquisitionVerdict =>
    ({ acquisition: "UNSUPPORTED", guidedPath: null, requiresLocalAgent: false, fallback: null, acquisitionEvidence: { verification, source } });
  if (!row) return none("NEEDS_VERIFICATION", "overview:absent");
  // The pull connector serves it, or a scheduled API path does ⇒ the product can refresh it alone.
  const scheduledApi = row.acquisitionPaths.find((p) => p.method.toUpperCase() === "API" && p.recurrence.toUpperCase() === "SCHEDULED");
  // A channel the backend itself lists as having no API for this data type (`ChannelApiGapRegistry`, e.g.
  // `REVIEW_API` for NAVER/Coupang) is never AUTOMATIC, whatever the connector row's `supported` bit says.
  const apiGap = dataType === "REVIEW"
    && (sources.overview?.unsupportedScopes ?? []).some((s) => s.code.toUpperCase() === "REVIEW_API");
  if (!apiGap && (row.supported || scheduledApi)) {
    return {
      acquisition: "AUTOMATIC", guidedPath: null, requiresLocalAgent: false, fallback: null,
      acquisitionEvidence: { verification: scheduledApi?.verificationStatus ?? row.verificationStatus ?? "NEEDS_VERIFICATION", source: "overview:connector" },
    };
  }
  // A seller-repeated path: the seller performs the platform's own confirmations, reviewnary
  // prepares, detects and ingests. Which carrier is the channel's own fact (table above).
  const guided = row.acquisitionPaths.find((p) => GUIDED_PATH_OF[`${code}:${p.method.toUpperCase()}`] != null);
  if (guided) {
    const path = GUIDED_PATH_OF[`${code}:${guided.method.toUpperCase()}`]!;
    return {
      acquisition: "GUIDED_HUMAN_ACTION", guidedPath: path, requiresLocalAgent: true,
      // Only an EXPORT has a file the seller could hand over by hand; a WING read has no fallback.
      fallback: path === "EXPORT_ACTION_WINDOW" ? FILE_UPLOAD_FALLBACK : null,
      acquisitionEvidence: { verification: guided.verificationStatus, source: `overview:${guided.method.toUpperCase()}` },
    };
  }
  // A channel whose only path is the seller's own file (`MANUAL`) reaches us by file upload — that IS its
  // acquisition path. An EXPORT with no reviewnary carrier is not turned into "upload a file": the fallback
  // exists only beside a guided path (Acceptance Closure §12). Whether the helper is paired right now is a
  // runtime-availability fact the screen resolves (`requiresLocalAgent` + `fallback`), not a capability.
  const upload = row.acquisitionPaths.find((p) => p.method.toUpperCase() === "MANUAL");
  if (upload) {
    return {
      acquisition: "GUIDED_HUMAN_ACTION", guidedPath: "FILE_UPLOAD", requiresLocalAgent: false, fallback: null,
      acquisitionEvidence: { verification: upload.verificationStatus, source: `overview:${upload.method.toUpperCase()}` },
    };
  }
  return none(row.verificationStatus ?? "NEEDS_VERIFICATION", "overview:no-path");
}

/** Inquiry execution: the audited transport row for (channel, subtype), qualified by what this deployment wired. */
export function inquiryExecutionOf(channelCode: string, sourceSubtype: string | null, sources: ChannelCapabilitySources): ExecutionVerdict {
  const code = channelCode.toUpperCase();
  const rows = (sources.transports ?? []).filter((r) => r.channelCode.toUpperCase() === code);
  const row = rows.find((r) => (r.sourceSubtype ?? null) === (sourceSubtype ?? null))
    ?? (sourceSubtype == null && rows.length === 1 ? rows[0]! : null);
  if (!row) {
    return { execution: "NOT_SUPPORTED", reason: EXECUTION_REASON.CAPABILITY_UNKNOWN, reasonKo: null,
      executionEvidence: { verification: "NEEDS_VERIFICATION", source: "transports:absent" } };
  }
  const transport = row.transport.toUpperCase();
  if (transport === "DIRECT_API") {
    const wired = sources.publish != null && sources.publish.executionEnabled
      && sources.publish.replyAdapterChannelCodes.some((c) => c.toUpperCase() === code);
    return wired
      ? { execution: "API_EXECUTION", reason: null, reasonKo: null, executionEvidence: { verification: "IMPLEMENTED", source: `transports:${row.evidence ?? "DIRECT_API"}` } }
      : { execution: "NOT_SUPPORTED", reason: EXECUTION_REASON.EXECUTION_DISABLED, reasonKo: null,
          executionEvidence: { verification: "IMPLEMENTED", source: "capability:execution-disabled" } };
  }
  if (transport === "GUIDED_ACTION") {
    return { execution: "GUIDED_BROWSER_EXECUTION", reason: null, reasonKo: row.reasonKo,
      executionEvidence: { verification: "NEEDS_VERIFICATION", source: `transports:${row.evidence ?? "GUIDED_ACTION"}` } };
  }
  return { execution: "NOT_SUPPORTED", reason: transport, reasonKo: row.reasonKo,
    executionEvidence: { verification: transport === "NEEDS_VERIFICATION" ? "NEEDS_VERIFICATION" : "AUDITED", source: `transports:${row.evidence ?? transport}` } };
}

/** Review execution: the backend's closed `executionKind`; absent ⇒ NOT_SUPPORTED (fail closed). */
export function reviewExecutionOf(sources: ChannelCapabilitySources): ExecutionVerdict {
  const view = sources.reviewChannel;
  if (!view) {
    return { execution: "NOT_SUPPORTED", reason: EXECUTION_REASON.CAPABILITY_UNKNOWN, reasonKo: null,
      executionEvidence: { verification: "NEEDS_VERIFICATION", source: "review-channel:absent" } };
  }
  // `executionKind` is the backend's v2 verdict (flag + grant + channel) and wins when present; the older
  // `replySupported` bit (triage-era) only speaks when the view predates it.
  if (view.executionKind == null && !view.replySupported) {
    return { execution: "NOT_SUPPORTED", reason: EXECUTION_REASON.CHANNEL_UNSUPPORTED, reasonKo: null,
      executionEvidence: { verification: "AUDITED", source: "review-channel:replySupported=false" } };
  }
  const kind = view.executionKind ?? "NOT_SUPPORTED";
  if (kind === "NOT_SUPPORTED") {
    return { execution: "NOT_SUPPORTED", reason: view.executionReason ?? (view.executionKind ? EXECUTION_REASON.EXECUTION_DISABLED : EXECUTION_REASON.CAPABILITY_UNKNOWN),
      reasonKo: null, executionEvidence: { verification: "IMPLEMENTED", source: "review-channel:executionKind" } };
  }
  return { execution: kind, reason: null, reasonKo: null, executionEvidence: { verification: "IMPLEMENTED", source: "review-channel:executionKind" } };
}

export interface CapabilityQuery {
  readonly channelCode: string;
  readonly dataType?: CapabilityDataType;
  readonly objectKind?: "INQUIRY" | "REVIEW";
  readonly sourceSubtype?: string | null;
}

export interface ChannelCapabilityVerdict extends AcquisitionVerdict, ExecutionVerdict {
  readonly channelCode: string;
  readonly localAgent: LocalAgentHint;
}

/** The one entry point: acquisition for `dataType` (default REVIEW) and execution for `objectKind` (default REVIEW). */
export function capabilityOf(query: CapabilityQuery, sources: ChannelCapabilitySources): ChannelCapabilityVerdict {
  const code = query.channelCode.toUpperCase();
  const acquisition = acquisitionOf(code, query.dataType ?? "REVIEW", sources);
  const execution = (query.objectKind ?? "REVIEW") === "INQUIRY"
    ? inquiryExecutionOf(code, query.sourceSubtype ?? null, sources)
    : reviewExecutionOf(sources);
  return { channelCode: code, localAgent: sources.localAgent, ...acquisition, ...execution };
}
