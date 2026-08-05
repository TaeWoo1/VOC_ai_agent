/**
 * The read-only fixed-label TAG script's ancestor-promotion (`tagAncestor`) — the credentials-row highlight.
 *
 * Two halves:
 *  - HERMETIC (always runs): the generated script text promotes the tag to `el.closest("tr")` for credentials
 *    (falling back to the label), leaves single-element targets (create_app/api_group) untouched, keeps the
 *    anti-drift `sig` computed on the LABEL `el`, and reads no `<td>` value (no `.value`/`.innerText`/child text).
 *  - REAL-CHROMIUM (RUN_INTEGRATION=1): against a real key/value `<tr><th>애플리케이션 ID</th><td>…</td></tr>`
 *    table, the tag lands on the `<tr>` (boxing the value cell) — and on a bare label with no row it falls back to
 *    the `<th>`. The `<td>` value string never leaves the page (count/sig only).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { buildFixedLabelLocateScript } from "../../../src/action-window/api-issuance-calibration/visual-recon-inpage";
import { locatorFor, type IssuanceHighlightTarget } from "../../../src/action-window/api-issuance-calibration/issuance-highlight-selectors";

/** Reconstruct the driver's per-target tag script (mirrors `NaverIssuanceDriver.issuanceLocateScript`). */
function tagScript(target: IssuanceHighlightTarget): string {
  const loc = locatorFor(target);
  return buildFixedLabelLocateScript({ candidateQuery: loc.candidateQuery, exactText: loc.exactText, tag: true, tagAncestor: loc.tagAncestor });
}

describe("fixed-label tag ancestor-promotion — script text (hermetic)", () => {
  it("credentials promotes the tag to el.closest('tr'), falling back to the label", () => {
    const s = tagScript("application_id");
    expect(s).toContain('el.closest("tr")');
    // Fallback: the ancestor is applied only when found; otherwise the label cell keeps the tag.
    expect(s).toContain("var tagEl = el;");
    expect(s).toContain("if (anc) { tagEl = anc; }");
    expect(s).toContain("tagEl.setAttribute('data-aw-target', '')");
  });

  it("create_app / api_group are single-element targets — NO ancestor promotion (tag on the matched element)", () => {
    for (const t of ["create_app", "api_group"] as const) {
      const s = tagScript(t);
      expect(s.includes(".closest(")).toBe(false);
      // Still tags via the same `tagEl` = el path (which is just the label element, unpromoted).
      expect(s).toContain("var tagEl = el;");
      expect(s).toContain("tagEl.setAttribute('data-aw-target', '')");
    }
  });

  it("the anti-drift sig stays computed on the LABEL el, never the promoted ancestor", () => {
    const s = tagScript("application_id");
    // sig is derived from `el` (the label) — not `tagEl`/`anc` — so the locate↔highlight signature is stable.
    expect(s).toContain("sig(el.tagName + ':' + idx, 'children:' + el.childElementCount)");
    expect(s.includes("sig(tagEl")).toBe(false);
    expect(s.includes("sig(anc")).toBe(false);
  });

  it("value-free: promotion reads STRUCTURE only — no <td> value / innerText / value read is added", () => {
    const s = tagScript("application_id");
    // The only text read is the existing label comparison via `textContent` in `accName` (the label, not the value).
    // The promotion path introduces no `.value`, `.innerText`, `.innerHTML`, or child-cell text read.
    expect(/\.value\b/.test(s)).toBe(false);
    expect(s.includes(".innerText")).toBe(false);
    expect(s.includes(".innerHTML")).toBe(false);
    // `closest` is the sole DOM traversal the promotion adds — a structural (selector) walk, no content.
    expect(s).toContain("el.closest");
  });
});

const RUN = process.env.RUN_INTEGRATION === "1";
const CRED_VALUE = "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"; // a UUID-shaped value that must NEVER leave the page
const KV_TABLE = `<!doctype html><table><tbody>
  <tr id="cred-row"><th>애플리케이션 ID</th><td id="cred-val">${CRED_VALUE}</td></tr>
  <tr><th>애플리케이션 시크릿</th><td>••••••</td></tr>
</tbody></table>`;
// A single element matching the fixed label with NO ancestor <tr> (a bare <label>, not nested in a row).
const BARE_LABEL = `<!doctype html><label id="lbl">애플리케이션 ID</label>`;

describe.skipIf(!RUN)("fixed-label tag ancestor-promotion — real Chromium DOM", () => {
  let browser: Browser | null = null;
  beforeAll(async () => {
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      browser = null;
    }
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("promotes the credentials tag onto the parent <tr> (boxes the value cell), value never returned", async (c) => {
    if (!browser) return c.skip();
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent(KV_TABLE);
      const res = (await page.evaluate(tagScript("application_id"))) as { count: number; sig?: string };
      expect(res.count).toBe(1);
      expect(typeof res.sig).toBe("string");
      // The tag landed on the ROW, not the label cell or the value cell.
      expect(await page.evaluate(() => document.querySelector("[data-aw-target]")?.id)).toBe("cred-row");
      expect(await page.evaluate(() => document.querySelector("[data-aw-target]")?.tagName)).toBe("TR");
      // The value cell is INSIDE the tagged row (so the overlay boxes it) but its text never left the page.
      expect(JSON.stringify(res).includes(CRED_VALUE)).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  it("falls back to the label element when there is no ancestor <tr>", async (c) => {
    if (!browser) return c.skip();
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent(BARE_LABEL);
      const res = (await page.evaluate(tagScript("application_id"))) as { count: number };
      expect(res.count).toBe(1);
      // No <tr> ancestor → tag stays on the matched label element, never silently dropped.
      expect(await page.evaluate(() => document.querySelector("[data-aw-target]")?.id)).toBe("lbl");
      expect(await page.evaluate(() => document.querySelector("[data-aw-target]")?.tagName)).toBe("LABEL");
    } finally {
      await ctx.close();
    }
  });

  it("api_group tags its own heading element (no promotion) even when nested in a container", async (c) => {
    if (!browser) return c.skip();
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.setContent(`<!doctype html><section><h4 id="grp" class="sub-title">API 그룹</h4></section>`);
      const res = (await page.evaluate(tagScript("api_group"))) as { count: number };
      expect(res.count).toBe(1);
      expect(await page.evaluate(() => document.querySelector("[data-aw-target]")?.id)).toBe("grp");
    } finally {
      await ctx.close();
    }
  });
});
