/**
 * **Pure, no-click locate decisions for the import targets — DOM-protocol step 1.**
 *
 * The protocol for a NAVER surface whose markup we do not know is: build bounded, fail-closed discovery
 * with sanitized diagnostics, test the modeled shape offline, THEN run live, and if a control is not found
 * stop and ask for minimum structural information rather than guess again. This module is the offline-
 * testable half of that, so the only thing a live run has to answer is whether the model was right.
 *
 * ## What is grounded and what is modeled — stated, because it decides what a live failure means
 *
 * **Grounded.** The date-input predicate is the one `naver-live-driver.readExportScope` already uses on a
 * real surface (`input[type=date]` plus class-contains date/calendar/picker). It has read real selected
 * values, so date inputs ARE reachable this way. Reusing it here rather than inventing a second predicate
 * also means locate and read-back can never disagree about which inputs are the date inputs — a class of
 * bug where the runtime highlights one control and validates another.
 *
 * **Modeled, and the live run's job to confirm.** Two things:
 *  1. **Order.** That the first matching input in document order is the start date and the second is the
 *     end. Korean date-range UIs are overwhelmingly start-then-end, but that is a convention, not a fact
 *     about this surface.
 *  2. **The apply control.** Whether it exists and what it is called. `readSurfaceFacts` answers the
 *     first; {@link locateApplyDecision} models the second from wording.
 *
 * Because both are modeled, both fail CLOSED: anything other than exactly one confident match returns a
 * count the engine turns into `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`, and the run stops rather than
 * highlighting a control the seller would then click.
 *
 * Zero imports. No DOM API, no `Date`, no I/O — the input is HTML text.
 */

/** The locate verdict shape the engine already understands (0 / 1 / many). */
export interface ImportLocateDecision {
  count: number;
  /** Present only when `count === 1`. Zero-based index among the matched inputs, for in-page binding. */
  index?: number;
}

/**
 * Sanitized diagnostics for a locate that did not resolve. Counts and booleans only — never a selector,
 * an attribute value, a URL, or page text. This is what may be logged, and what an operator may be asked
 * about when the model turns out to be wrong.
 */
export interface ImportLocateDiagnostic {
  /**
   * How many inputs matched the date predicate at all, BEFORE any actionability filter.
   *
   * Separate from {@link ImportLocateDiagnostic.dateInputCount} because one number could not distinguish
   * "the predicate matches nothing" from "it matched and our own filter threw them away" — and the second
   * is what happened on the first live run. A diagnostic that applies the same filter as the decision it
   * explains cannot explain that decision.
   */
  dateInputTotal: number;
  /** How many of those the seller could act on. */
  dateInputCount: number;
  /**
   * Why the rest were excluded, per rule. A total and an actionable count still cannot say WHICH exclusion
   * fired, and three live runs were spent on exclusions nobody could see.
   *
   * FLAT scalars, not a nested object: the log sanitizer collapses any non-scalar to a type tag, so a
   * nested bag reached the log as `"[object]"` and was useless exactly when it was needed.
   */
  dateExcludedDisabled: number;
  dateExcludedHidden: number;
  dateExcludedDisplayNone: number;
  /** Whether any element carried apply-like wording. */
  applyWordingPresent: boolean;
  /** How many elements carried apply-like wording. */
  applyCandidateCount: number;
  /** Whether the page contained any iframe at all (a frame-scoping question, not a host). */
  iframePresent: boolean;
}

/**
 * The date-input predicate, as an attribute-level test over one tag's text.
 *
 * Kept as a string test rather than a CSS selector so the module stays DOM-free and unit-testable. It
 * mirrors `readExportScope`'s selector exactly — see the module note on why they must not diverge.
 */
function isDateInputTag(tag: string): boolean {
  if (!/^<input\b/i.test(tag)) return false;
  if (/type\s*=\s*["']?date["']?/i.test(tag)) return true;
  const classMatch = /class\s*=\s*["']([^"']*)["']/i.exec(tag);
  if (!classMatch) return false;
  const cls = classMatch[1]!.toLowerCase();
  return cls.includes("date") || cls.includes("calendar") || cls.includes("picker");
}

/** Every `<input ...>` tag in document order. */
function inputTags(html: string): string[] {
  return html.match(/<input\b[^>]*>/gi) ?? [];
}

/** Inputs matching the grounded date predicate, in document order. */
export function dateInputTags(html: string): string[] {
  return inputTags(html).filter(isDateInputTag);
}

/**
 * Hidden or disabled controls are not ones the seller can act on, so highlighting one would leave them
 * hunting. Excluded before counting, which also keeps a template/off-screen picker from making a match
 * ambiguous.
 *
 * WARNING: `readonly` is NOT a disqualifier, and that correction came from a live run. The 2026-07-25 run
 * reported zero date inputs on a surface where the operator confirmed two were visible from page load. A
 * calendar-backed date field is almost always `readonly` — it means "do not type", not "cannot use", and
 * the seller drives it through the picker. Excluding it dropped exactly the controls this module exists to
 * find. `readExportScope`, which has read real values from this same surface, applies no such filter, which
 * is the other half of why the two disagreed.
 */
function exclusionReason(tag: string): "disabled" | "hidden" | "displayNone" | null {
  if (isTrulyDisabled(tag)) return "disabled";
  if (/type\s*=\s*["']?hidden["']?/i.test(tag)) return "hidden";
  if (/style\s*=\s*["'][^"']*display\s*:\s*none/i.test(tag)) return "displayNone";
  return null;
}

/**
 * A REAL `disabled` boolean attribute — not the substring "disabled" anywhere in the tag.
 *
 * A word-boundary search matches `aria-disabled="false"`, `data-disabled="0"` and a class like
 * `is-disabled`, so an input explicitly declaring itself ENABLED was excluded as disabled. That produced
 * `dateInputTotal: 2, dateInputCount: 0` on the 2026-07-25 run: the predicate found both date fields and
 * this rule threw them both away.
 *
 * Accepts the HTML boolean forms and requires the attribute to begin at a boundary, so it cannot be the
 * tail of a longer attribute name.
 */
function isTrulyDisabled(tag: string): boolean {
  const match = /(?:^|\s)disabled(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/i.exec(tag);
  if (!match) return false;
  const value = (match[1] ?? match[2] ?? match[3] ?? "").trim().toLowerCase();
  return value !== "false" && value !== "0";
}

function isActionable(tag: string): boolean {
  return exclusionReason(tag) === null;
}

/**
 * Locate the start or end date control.
 *
 * Requires **exactly two** actionable date inputs. Fewer means the surface is not what we modeled; more
 * means we cannot tell which pair is the range, and picking the first two would be exactly the guess the
 * DOM protocol forbids. Both return a count the engine fails closed on.
 */
export function locateDateDecision(html: string, which: "start" | "end"): ImportLocateDecision {
  const actionable = dateInputTags(html).filter(isActionable);
  if (actionable.length !== 2) return { count: actionable.length === 0 ? 0 : actionable.length };
  return { count: 1, index: which === "start" ? 0 : 1 };
}

/**
 * Wording that marks a search/apply control on a Korean seller surface. Deliberately short: every entry
 * is a word that means "apply this filter now", and widening it toward generic verbs is how a locate
 * starts matching unrelated buttons.
 */
const APPLY_WORDING: readonly string[] = ["조회", "검색", "적용", "search"];

/** Tags that can plausibly BE a control, so prose containing 조회 cannot become a candidate. */
function controlTags(html: string): string[] {
  const tags = html.match(/<(?:button|a|input)\b[^>]*>[^<]*(?:<\/(?:button|a)>)?/gi) ?? [];
  return tags;
}

function hasApplyWording(tag: string): boolean {
  const lower = tag.toLowerCase();
  return APPLY_WORDING.some((word) => lower.includes(word.toLowerCase()));
}

/**
 * Locate the apply control.
 *
 * Modeled from wording, so it fails closed on 0 and on >1 alike. A surface with two 조회 buttons is a
 * surface we do not understand yet, and the honest response is to stop and ask what distinguishes them —
 * not to take the first one and hope.
 */
export function locateApplyDecision(html: string): ImportLocateDecision {
  const candidates = controlTags(html).filter((tag) => isActionable(tag) && hasApplyWording(tag));
  if (candidates.length !== 1) return { count: candidates.length };
  return { count: 1, index: 0 };
}

/**
 * Whether this surface appears to require a separate apply press.
 *
 * Answered from the presence of an apply-worded control, and deliberately conservative: when no such
 * control is found the run treats the range as taking effect directly. That is the safe direction —
 * `requiresApply: true` with no control would highlight nothing and strand the seller, whereas
 * `requiresApply: false` on a surface that did need applying is caught immediately afterwards by the scope
 * read-back, which sees the un-applied window and blocks.
 */
export function inferRequiresApply(html: string): boolean {
  return locateApplyDecision(html).count === 1;
}

/** Sanitized diagnostics for a failed locate. Counts and booleans only. */
export function importLocateDiagnostic(html: string): ImportLocateDiagnostic {
  const applyCandidates = controlTags(html).filter((tag) => isActionable(tag) && hasApplyWording(tag));
  const dateTags = dateInputTags(html);
  const dateExcluded = { disabled: 0, hidden: 0, displayNone: 0 };
  for (const tag of dateTags) {
    const reason = exclusionReason(tag);
    if (reason) dateExcluded[reason] += 1;
  }
  return {
    dateInputTotal: dateTags.length,
    dateInputCount: dateTags.filter(isActionable).length,
    dateExcludedDisabled: dateExcluded.disabled,
    dateExcludedHidden: dateExcluded.hidden,
    dateExcludedDisplayNone: dateExcluded.displayNone,
    applyWordingPresent: applyCandidates.length > 0,
    applyCandidateCount: applyCandidates.length,
    iframePresent: /<iframe\b/i.test(html),
  };
}

/**
 * The minimum structural questions to ask an operator when a locate fails live.
 *
 * Returned as fixed dotted keys rather than prose so the questions cannot drift into asking for something
 * they should not. **Nothing here asks for review text, customer data, identifiers, a URL with a path or
 * query, cookies, tokens, or page HTML containing personal data** — only tag, role/type, non-sensitive
 * class names, iframe presence, container structure, and sibling relationships.
 */
export const IMPORT_DOM_QUESTION_KEYS: readonly string[] = [
  "dom.question.dateInput.tagName",
  "dom.question.dateInput.typeAttribute",
  "dom.question.dateInput.nonSensitiveClassNames",
  "dom.question.dateInput.insideIframe",
  "dom.question.dateInput.parentContainerStructure",
  "dom.question.dateInput.startAndEndAreSiblings",
  "dom.question.dateInput.calendarWidgetOrPlainInput",
  "dom.question.applyControl.exists",
  "dom.question.applyControl.tagName",
  "dom.question.applyControl.roleAttribute",
  "dom.question.applyControl.nonSensitiveClassNames",
  "dom.question.applyControl.siblingOfDateInputs",
];

/** Which questions are worth asking, given what the diagnostic saw. */
export function importDomQuestionsFor(diagnostic: ImportLocateDiagnostic): readonly string[] {
  const questions: string[] = [];
  if (diagnostic.dateInputCount !== 2) {
    questions.push(
      "dom.question.dateInput.tagName",
      "dom.question.dateInput.typeAttribute",
      "dom.question.dateInput.nonSensitiveClassNames",
      "dom.question.dateInput.insideIframe",
      "dom.question.dateInput.parentContainerStructure",
      "dom.question.dateInput.startAndEndAreSiblings",
      "dom.question.dateInput.calendarWidgetOrPlainInput",
    );
  }
  if (diagnostic.applyCandidateCount !== 1) {
    questions.push(
      "dom.question.applyControl.exists",
      "dom.question.applyControl.tagName",
      "dom.question.applyControl.roleAttribute",
      "dom.question.applyControl.nonSensitiveClassNames",
      "dom.question.applyControl.siblingOfDateInputs",
    );
  }
  return questions;
}
