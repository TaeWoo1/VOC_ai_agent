/**
 * The fail-closed check on what may travel to an outside annotator (RUBRIC v2 §7.7).
 *
 * Deliberately narrow and deliberately blunt. It looks for the shapes of *direct* identifiers a
 * buyer sometimes types into a review — a phone number, an email address, a card-or-registration
 * length digit run — and REFUSES the row rather than redacting it. A redaction would let a
 * near-miss through in a form that looks handled; a refusal leaves the row where it started, on the
 * machine that already holds it, to be labeled by the owner.
 *
 * It is not a claim that a body clearing it contains no personal data. Free prose can identify a
 * person with no pattern at all, and nothing here would catch that. It bounds the obvious cases,
 * and RUBRIC v2 §7.7 states the residual instead of pretending this closes it.
 */

const PATTERNS = [
  // Korean mobile / landline, with or without separators. `01012345678`, `010-1234-5678`, `02 123 4567`.
  { name: "phone", re: /(?:^|[^0-9])(01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4})(?:[^0-9]|$)/ },
  { name: "email", re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  // 13 digits with an optional hyphen after six: the shape of a resident registration number.
  { name: "id-number", re: /(?:^|[^0-9])\d{6}[-\s]?[1-4]\d{6}(?:[^0-9]|$)/ },
  // Any run of 12 or more digits. Card numbers, account numbers, order numbers — none of which
  // belong in a packet leaving this machine, and all of which are cheap to refuse.
  { name: "long-digit-run", re: /\d{12,}/ },
];

/** `null` when the body may travel, otherwise the name of the pattern that refused it. */
export function refuseReason(body) {
  const text = body ?? "";
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) {
      return name;
    }
  }
  return null;
}
