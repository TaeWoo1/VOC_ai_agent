import { axe } from "jest-axe";
import { expect } from "vitest";

// Shared axe-core config for the FE-9 page-level a11y scans.
//
// The Operations pages render as a page *body* fragment — AppShell owns the
// document landmarks (<main>/nav) in the real app, so scanning the isolated
// fragment would false-positive on landmark rules. And jsdom never lays out or
// paints, so color-contrast can't be computed. Those three rules are therefore
// disabled here; every other rule (ARIA validity, duplicate-id, label/name,
// required-states, roles, headings, lists…) stays on.
const AXE_OPTIONS = {
  rules: {
    region: { enabled: false },
    "landmark-one-main": { enabled: false },
    "color-contrast": { enabled: false },
  },
};

// Runs axe over a rendered container and fails with a readable, rule-by-rule
// summary. Asserting on `violations` directly (rather than expect.extend'ing
// jest-axe's matcher) keeps us clear of the `globals: false` matcher-typing
// friction — no setup.ts change, no type shim.
export async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const { violations } = await axe(container, AXE_OPTIONS);
  const summary = violations
    .map((v) => `  • ${v.id} [${v.impact ?? "n/a"}] ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(violations, summary ? `axe found violations:\n${summary}` : undefined).toHaveLength(0);
}
