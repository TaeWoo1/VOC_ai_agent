/**
 * **Chrome-identity extraction real-DOM rung (RUN_INTEGRATION=1; headless, localhost fixture).**
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/reply-submission/chrome-identity-browser.test.ts
 *
 * The bounds that keep customer-controlled text out of the identity are DOM behaviour, so they can only be
 * proven in a DOM. This milestone deleted three text sources after each one turned out to be reachable by a
 * review body; the case below marked THE ONE is the direct rebuttal for this design.
 *
 * The fixture is a seller-shell-*shaped* page with no marketplace trademark or markup, and a planted review
 * row that reproduces the real user id and shop name verbatim.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import {
  MAX_CHROME_TEXT,
  inPageChromeIdentity,
  parseChromeIdentity,
} from "../../../src/action-window/reply-submission/chrome-identity-inpage";
import {
  compositeSessionFingerprint,
  verifyChromeIdentity,
} from "../../../src/action-window/reply-submission/session-chrome-identity";

const RUN = process.env.RUN_INTEGRATION === "1";

const USER = "seller_alpha";
const SHOP = "알파 스토어";
const USER_SEL = ["#gnb-account .user-id"];
const SHOP_SEL = ["#shop-switcher .shop-name"];

let server: http.Server;
let browser: Browser;
let page: Page;
let base: string;
let body = "";

function shell(inner: string): string {
  return `<!doctype html><html><head><title>shell</title></head><body>${inner}</body></html>`;
}

/** Chrome the way a seller center has it: a header account chip and a shop switcher. */
const CHROME = `
<header id="gnb-account"><span class="user-id">${USER}</span></header>
<aside id="shop-switcher"><span class="shop-name">${SHOP}</span></aside>`;

/** A review row that reproduces BOTH identity values verbatim, inside a real table. */
const HOSTILE_REVIEW = `
<table><tbody>
  <tr><td><div class="user-id">${USER}</div><div class="shop-name">${SHOP}</div>
      <p>이 판매자 ${USER} 의 ${SHOP} 에서 샀어요</p></td></tr>
</tbody></table>`;

beforeAll(async () => {
  if (!RUN) return;
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  if (!RUN) return;
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

async function extract(html: string, userSel = USER_SEL, shopSel = SHOP_SEL) {
  body = html;
  await page.goto(`${base}?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
  const raw = await (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<string>(
    inPageChromeIdentity(userSel, shopSel),
  );
  return { raw, parsed: parseChromeIdentity(raw) };
}

describe.runIf(RUN)("chrome identity — real DOM", () => {
  it("reads both fields from the pinned containers", async () => {
    const { parsed } = await extract(shell(CHROME));
    expect(parsed?.userId.value?.trim()).toBe(USER);
    expect(parsed?.shopName.value?.trim()).toBe(SHOP);
    expect(parsed?.userId.selectorIndex).toBe(0);
  });

  it("THE ONE: a review row reproducing both values verbatim changes nothing", async () => {
    // Same page, same pinned selectors, plus a review row carrying identical text in
    // identically-classed elements. The selectors still resolve to the chrome elements,
    // and the identity is unchanged.
    const clean = await extract(shell(CHROME));
    const hostile = await extract(shell(CHROME + HOSTILE_REVIEW));
    expect(hostile.parsed?.userId.value).toBe(clean.parsed?.userId.value);
    expect(hostile.parsed?.shopName.value).toBe(clean.parsed?.shopName.value);
    expect(
      compositeSessionFingerprint(hostile.parsed!.userId.value, hostile.parsed!.shopName.value),
    ).toBe(compositeSessionFingerprint(USER, SHOP));
  });

  it("a selector that ALSO matches review rows fails closed rather than picking", async () => {
    // The load-bearing bound: several matches is a refusal. Without it, a selector broad
    // enough to catch the real header would happily read a review row instead.
    const { parsed } = await extract(shell(CHROME + HOSTILE_REVIEW), [".user-id"], [".shop-name"]);
    expect(parsed?.userId.value).toBeNull();
    expect(parsed?.userId.rejections).toContain("multiple-matches");
    expect(parsed?.shopName.value).toBeNull();
    // And an unreadable field is UNAVAILABLE, never a MATCH.
    const v = verifyChromeIdentity({
      observedUserId: parsed!.userId.value,
      observedShopName: parsed!.shopName.value,
      boundCompositeFingerprint: compositeSessionFingerprint(USER, SHOP),
      boundShopDisplayName: SHOP,
      currentSelectorSpecFingerprint: "a".repeat(64),
      boundSelectorSpecFingerprint: "a".repeat(64),
      selectorsCollide: false,
    });
    expect(v.verdict).toBe("UNAVAILABLE");
  });

  it("rejects a container that sits INSIDE a content region", async () => {
    const inRow = `<table><tbody><tr><td><span id="only-user" class="x">${USER}</span></td></tr></tbody></table>`;
    const { parsed } = await extract(shell(inRow), ["#only-user"], SHOP_SEL);
    expect(parsed?.userId.value).toBeNull();
    expect(parsed?.userId.rejections).toContain("inside-content-region");
  });

  it("rejects a container that CONTAINS a content region", async () => {
    const wrapper = `<div id="wrap">${USER}<table><tbody><tr><td>review</td></tr></tbody></table></div>`;
    const { parsed } = await extract(shell(wrapper), ["#wrap"], SHOP_SEL);
    expect(parsed?.userId.value).toBeNull();
    expect(parsed?.userId.rejections).toContain("contains-content-region");
  });

  it("rejects an untight container whose text is longer than any real field", async () => {
    const loose = `<div id="loose">${"x".repeat(MAX_CHROME_TEXT + 1)}</div>`;
    const { parsed } = await extract(shell(loose), ["#loose"], SHOP_SEL);
    expect(parsed?.userId.value).toBeNull();
    expect(parsed?.userId.rejections).toContain("text-too-long");
  });

  it("falls through candidate selectors in order and reports why each failed", async () => {
    // The review row is present so `.user-id` is genuinely ambiguous — without it that
    // candidate would resolve cleanly and the fall-through would never be exercised.
    const { parsed } = await extract(shell(CHROME + HOSTILE_REVIEW), [
      "#missing",
      ".user-id",
      "#gnb-account .user-id",
    ]);
    expect(parsed?.userId.selectorIndex).toBe(2);
    expect(parsed?.userId.rejections).toEqual(["no-match", "multiple-matches"]);
  });

  it("leaves the DOM byte-identical — extraction has no legitimate mutation", async () => {
    body = shell(CHROME + HOSTILE_REVIEW);
    await page.goto(`${base}?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    const evaluate = (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate.bind(page);
    const before = await evaluate<string>(`document.documentElement.outerHTML`);
    await evaluate<string>(inPageChromeIdentity(USER_SEL, SHOP_SEL));
    const after = await evaluate<string>(`document.documentElement.outerHTML`);
    expect(after).toBe(before);
  });
});
