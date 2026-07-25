/**
 * **Pure: the guided step sequence for ONE import segment, and when to stop.**
 *
 * The seller is walked through the seller center like a tutorial — required dates, start control, end
 * control, apply, export, consent — and the runtime highlights each in turn while the SELLER performs every
 * click. This module owns the ordering and the gate decisions; the driver owns the DOM. Keeping the sequence
 * pure means the whole choreography (including the awkward branches) is pinned offline, which is the point:
 * a wrong ordering discovered during a seated live run costs an export window, not a test run.
 *
 * **The gate is the reason this exists.** After the dates are set we ask whether what is selected matches the
 * segment we are importing. Three answers, three different obligations:
 *  - `MATCH`      → continue, and record that SellerOps itself confirmed the scope;
 *  - `MISMATCH`   → PAUSE. Do not highlight export. A file covering the wrong window would be ingested as
 *                   though it covered this segment, which is worse than not importing at all;
 *  - `UNREADABLE` → continue, but the seller must confirm the dates, and the evidence recorded is THEIR
 *                   confirmation. Never labelled as a machine check.
 *
 * Zero imports beyond the scope verdict type, no `Date`, no DOM.
 */
import type { ScopeMatch } from "./export-scope-match";

/**
 * One guided moment in the sequence. `stage` is what the runtime should do next; the FE maps the matching
 * copy key to prose and shows the required dates from sanitized copy params.
 */
export type ImportGuidanceStage =
  /** Confirm the seller is on the review-management surface (never navigated for them mid-run). */
  | "OPEN_REVIEW_SURFACE"
  /** Show the required window before touching anything, so the seller knows the target. */
  | "SHOW_REQUIRED_RANGE"
  /** Highlight the start-date control and wait for the seller to set it. */
  | "SET_START_DATE"
  /** Highlight the end-date control and wait for the seller to set it. */
  | "SET_END_DATE"
  /** Highlight the search/apply control, when the surface requires applying the filter. */
  | "APPLY_RANGE"
  /** The seller confirms the range — only reached when the runtime could NOT read it back. */
  | "CONFIRM_RANGE"
  /** Highlight the export control. */
  | "EXPORT"
  /** Highlight NAVER's own consent/confirmation control (the live-proven modal path). */
  | "CONSENT"
  /** Download detected → validate → ingest into this segment. No seller action. */
  | "INGEST";

/** Semantic copy keys for each stage. Runtime never sends prose; the FE owns all of it. */
export const IMPORT_GUIDANCE_COPY_KEYS: Readonly<Record<ImportGuidanceStage, string>> = {
  OPEN_REVIEW_SURFACE: "actionWindow.import.openReviewSurface",
  SHOW_REQUIRED_RANGE: "actionWindow.import.showRequiredRange",
  SET_START_DATE: "actionWindow.import.setStartDate",
  SET_END_DATE: "actionWindow.import.setEndDate",
  APPLY_RANGE: "actionWindow.import.applyRange",
  CONFIRM_RANGE: "actionWindow.import.confirmRange",
  EXPORT: "actionWindow.import.export",
  CONSENT: "actionWindow.import.consent",
  INGEST: "actionWindow.import.ingest",
};

/** Which stages wait on the seller. The rest are runtime-side checks or automatic downstream work. */
export const SELLER_ACTION_STAGES: readonly ImportGuidanceStage[] = [
  "SET_START_DATE",
  "SET_END_DATE",
  "APPLY_RANGE",
  "CONFIRM_RANGE",
  "EXPORT",
  "CONSENT",
];

export function isSellerActionStage(stage: ImportGuidanceStage): boolean {
  return SELLER_ACTION_STAGES.includes(stage);
}

/** What the surface requires, as observed by the driver. */
export interface ImportSurfaceFacts {
  /** The surface has a separate search/apply control that must be pressed for the range to take effect. */
  requiresApply: boolean;
  /** Whether a filter beyond the date range is part of THIS import plan (V1: none are). */
  requiresFilters: boolean;
}

/**
 * The ordered stages for a segment run, before the gate is evaluated.
 *
 * `APPLY_RANGE` is included only when the surface actually has an apply control: highlighting a control that
 * is not there would leave the seller hunting for it, and a tutorial that points at nothing is worse than
 * one step shorter.
 */
export function planSegmentGuidance(facts: ImportSurfaceFacts): ImportGuidanceStage[] {
  const stages: ImportGuidanceStage[] = [
    "OPEN_REVIEW_SURFACE",
    "SHOW_REQUIRED_RANGE",
    "SET_START_DATE",
    "SET_END_DATE",
  ];
  if (facts.requiresApply) stages.push("APPLY_RANGE");
  stages.push("EXPORT", "CONSENT", "INGEST");
  return stages;
}

/** What the gate decided after the dates were set. */
export type GateDecision =
  /** Continue to the export stage; SellerOps confirmed the scope itself. */
  | { proceed: true; insertConfirmStage: false; scopeEvidence: "MACHINE_MATCHED" }
  /** Continue, but ask the seller to confirm first; the evidence is their confirmation. */
  | { proceed: true; insertConfirmStage: true; scopeEvidence: "OPERATOR_CONFIRMED" }
  /** Stop before export. Recoverable: the seller fixes the dates and asks for a re-check. */
  | { proceed: false; blocker: "SCOPE_MISMATCH"; recoverable: true };

/**
 * Pure: decide whether the run may proceed to export, given what the scope read-back concluded.
 *
 * A mismatch is `recoverable` on purpose — the seller changing the dates and asking for a re-check is the
 * normal repair, not a failed run. It is still a hard stop: nothing highlights the export control until the
 * selected window agrees with the segment.
 */
export function gateOnScope(match: ScopeMatch): GateDecision {
  switch (match) {
    case "MATCH":
      return { proceed: true, insertConfirmStage: false, scopeEvidence: "MACHINE_MATCHED" };
    case "UNREADABLE":
      return { proceed: true, insertConfirmStage: true, scopeEvidence: "OPERATOR_CONFIRMED" };
    case "MISMATCH":
      return { proceed: false, blocker: "SCOPE_MISMATCH", recoverable: true };
  }
}

/**
 * Pure: the full stage list once the gate has spoken.
 *
 * A blocked gate truncates the plan right before `EXPORT` rather than returning the untouched sequence — the
 * caller advancing through a list that still contains `EXPORT` is exactly how a mismatch would leak past the
 * gate, so the stop is expressed in the data, not left to the caller to remember.
 */
export function planSegmentGuidanceWithGate(
  facts: ImportSurfaceFacts,
  decision: GateDecision,
): ImportGuidanceStage[] {
  const stages = planSegmentGuidance(facts);
  const exportAt = stages.indexOf("EXPORT");
  if (!decision.proceed) return stages.slice(0, exportAt);
  if (decision.insertConfirmStage) stages.splice(exportAt, 0, "CONFIRM_RANGE");
  return stages;
}
