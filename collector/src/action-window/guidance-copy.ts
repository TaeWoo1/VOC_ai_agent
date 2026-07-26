/**
 * **Assemble the in-page guidance panel's text from the frontend's pack. Pure.**
 *
 * The whole module is lookup and `{param}` substitution. It contains no sentence, no word, and no Hangul —
 * `guidance-panel-purity.test.ts` asserts that — because contract §6 gives every user-facing word to the
 * frontend, and the panel lives in the marketplace page where nobody could tell whose wording it was.
 *
 * **A missing pack entry renders nothing, and that is the design.** There is no fallback prose to reach for:
 * if the frontend has no sentence for a step, the panel shows the spotlight and the step counter and stays
 * quiet. A runtime-authored "please follow the guidance" would be exactly the §6 violation this arrangement
 * exists to make impossible, and it would also be a sentence no product owner ever approved.
 *
 * No I/O, no browser, no wall-clock.
 */
import type { ActionWindowRunView, CopyParams } from "../../../contracts/action-window/v2/index";
import type { AwGuidancePack } from "../../../contracts/action-window/v2/transport";
import type { GuidancePanelAction, GuidancePanelState } from "./guidance-panel";

/**
 * Commands the panel may offer, in render order.
 *
 * A deliberate subset of the contract's `COMMAND_TYPES`, intersected with what the runtime reports as
 * allowed. `PAUSE_RUN` / `SET_GUIDANCE_ENABLED` / `FIND_CURRENT_STEP` are omitted: they are operator
 * diagnostics, and a seller mid-export needs the two decisions that actually exist for them — I did it, look
 * again; or stop.
 */
export const PANEL_COMMANDS: readonly string[] = ["REQUEST_STEP_RECHECK", "CANCEL_RUN"];

/** Statuses where a panel would be describing work that is over. */
const TERMINAL: readonly string[] = ["COMPLETED", "OPERATOR_REPORTED", "FAILED", "CANCELLED"];

function interpolate(template: string, params: CopyParams): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined ? "" : String(value);
  });
}

/**
 * The label for one command, in this situation.
 *
 * `REQUEST_STEP_RECHECK` resolves blocker → step → fallback: what a run is BLOCKED on describes the repair
 * better than the step it is nominally sitting at, and on the 2026-07-25 run a single fixed label ("확인 완료")
 * was wording the operator could not match to anything on their screen. Every other command takes its label
 * straight from the pack.
 */
export function panelCommandLabel(
  pack: AwGuidancePack,
  command: string,
  context: { stepCopyKey: string | null; blockerCode: string | null },
): string | null {
  if (command !== "REQUEST_STEP_RECHECK") return pack.commands[command] ?? null;
  const byBlocker = context.blockerCode ? pack.recheck.byBlocker[context.blockerCode] : undefined;
  if (byBlocker) return byBlocker;
  const byStep = context.stepCopyKey ? pack.recheck.byStep[context.stepCopyKey] : undefined;
  if (byStep) return byStep;
  return pack.recheck.fallback || pack.commands[command] || null;
}

/**
 * Project a published run view onto the panel, or null when there should be no panel.
 *
 * Null on two conditions, both meaning "the seller has nothing to do here": a terminal run, and a run whose
 * guidance the operator has switched off. A terminal run leaving its last instruction on screen is how a
 * finished import ends up looking like an unfinished one.
 */
export function guidancePanelStateFrom(
  view: ActionWindowRunView,
  pack: AwGuidancePack | null,
): GuidancePanelState | null {
  if (!pack) return null;
  if (TERMINAL.includes(view.status)) return null;
  if (!view.guidanceEnabled) return null;

  const step = view.currentStep;
  const params: CopyParams = { ...(step?.copyParams ?? {}) };
  const stepCopyKey = step?.copyKey ?? null;
  const blockerCode = view.blocker?.code ?? null;

  const stepTemplate = stepCopyKey ? pack.steps[stepCopyKey] : undefined;
  const instruction = stepTemplate ? interpolate(stepTemplate, params) : "";

  const stepLine =
    step && pack.chrome.stepCounter
      ? interpolate(pack.chrome.stepCounter, { step: step.stepNumber, total: step.totalSteps })
      : "";

  // The required window travels as sanitized primitives on the step's copyParams — the same values the
  // SellerOps card shows. A segment's dates are the target the seller has to match, not customer data.
  const start = params.requiredStart;
  const end = params.requiredEnd;
  const requiredRange =
    typeof start === "string" && typeof end === "string" && start !== "" && end !== "" && pack.chrome.requiredRange
      ? interpolate(pack.chrome.requiredRange, { start, end })
      : "";

  const blockerCopy = blockerCode ? pack.blockers[blockerCode] : undefined;
  const blocked =
    blockerCode && blockerCopy
      ? { label: pack.chrome.blockedLabel, title: blockerCopy.title, fix: blockerCopy.fix }
      : null;

  const actions: GuidancePanelAction[] = [];
  for (const command of PANEL_COMMANDS) {
    if (!view.allowedCommands.includes(command as never)) continue;
    const label = panelCommandLabel(pack, command, { stepCopyKey, blockerCode });
    // No label ⇒ no button. A control the frontend has not named is a control the seller cannot understand,
    // and inventing a name here would be the runtime writing copy.
    if (label) actions.push({ command, label });
  }

  return {
    product: pack.chrome.product,
    stepLine,
    instruction,
    requiredRange,
    blocked,
    actions,
  };
}

/**
 * Whether a client frame's payload is a usable guidance pack.
 *
 * Defensive because the frame arrives from a paired client and nothing about its shape is assumed. Shape
 * only — the CONTENT is the frontend's copy and is never inspected, counted by category, or judged here.
 */
export function isGuidancePack(value: unknown): value is AwGuidancePack {
  if (typeof value !== "object" || value === null) return false;
  const pack = value as Partial<AwGuidancePack>;
  const chrome = pack.chrome as Record<string, unknown> | undefined;
  if (!chrome || typeof chrome.product !== "string" || chrome.product === "") return false;
  if (typeof chrome.stepCounter !== "string" || typeof chrome.requiredRange !== "string") return false;
  if (typeof chrome.blockedLabel !== "string") return false;
  if (!isStringMap(pack.steps) || !isStringMap(pack.commands)) return false;
  if (!isRecord(pack.blockers)) return false;
  for (const entry of Object.values(pack.blockers as Record<string, unknown>)) {
    if (!isRecord(entry)) return false;
    const blocker = entry as Record<string, unknown>;
    if (typeof blocker.title !== "string" || typeof blocker.fix !== "string") return false;
  }
  const recheck = pack.recheck as Record<string, unknown> | undefined;
  if (!recheck || typeof recheck.fallback !== "string") return false;
  if (!isStringMap(recheck.byBlocker) || !isStringMap(recheck.byStep)) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}
