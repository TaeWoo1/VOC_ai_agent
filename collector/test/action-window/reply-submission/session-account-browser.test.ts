/**
 * **Store-identity probe real-DOM rung (RUN_INTEGRATION=1; headless, fully automated).**
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/reply-submission/session-account-browser.test.ts
 *
 * Three things only a real browser can prove, all load-bearing before a live run:
 *  1. the bounded walker actually finds an identity key in real SPA state and in inline JSON;
 *  2. it leaves the page **byte-identical** — this probe has no legitimate mutation at all;
 *  3. the fail-closed paths really fail: two different values for one key must resolve to nothing.
 *
 * The page is 100% synthetic — a seller-shell-*shaped* fixture with no marketplace trademark, markup, or
 * seller data. Canary strings are planted so the test can prove no page text crosses back.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import {
  inPageAccountIdentityProbe,
  parseAccountProbeResult,
} from "../../../src/action-window/reply-submission/session-account-probe-inpage";
import { chooseAccountIdentity } from "../../../src/action-window/reply-submission/session-account-identity";

const RUN = process.env.RUN_INTEGRATION === "1";

const CANARIES = ["CANARY_PAGE_TEXT", "CANARY_SELLER_NAME", "CANARY_CUSTOMER"];
const CHANNEL_NO = "100200300";
const PINNED = "channelNo";

function fixture(stateJson: string, inlineJson = "{}"): string {
  return `<!doctype html><html><head><title>${CANARIES[0]}</title>
<script>window.__PRELOADED_STATE__ = ${stateJson};</script>
<script type="application/json" id="extra">${inlineJson}</script>
</head><body>
<nav id="gnb">${CANARIES[1]}</nav>
<main><p>${CANARIES[2]}</p></main>
</body></html>`;
}

let server: http.Server;
let browser: Browser;
let page: Page;
let base: string;
let body = fixture("{}");

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

async function probe(html: string) {
  body = html;
  await page.goto(`${base}?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
  const raw = await (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<string>(
    inPageAccountIdentityProbe(),
  );
  return { raw, parsed: parseAccountProbeResult(raw) };
}

describe.runIf(RUN)("store-identity probe — real DOM", () => {
  it("finds an identity key in SPA state and returns nothing else", async () => {
    const { raw, parsed } = await probe(
      fixture(`{"shop":{"channelNo":"${CHANNEL_NO}","displayName":"${CANARIES[1]}"}}`),
    );
    expect(parsed?.hits).toEqual([{ key: "channelNo", value: CHANNEL_NO, root: "__PRELOADED_STATE__" }]);
    expect(parsed?.truncated).toBe(false);
    // No page text may ride along in the payload.
    for (const canary of CANARIES) expect(raw, `leaked ${canary}`).not.toContain(canary);

    const { chosen } = chooseAccountIdentity({ hits: parsed!.hits, pinnedKey: PINNED });
    expect(chosen?.token).toBe(`channelNo=${CHANNEL_NO}`);
  });

  it("finds an identity key inside an inline JSON script too", async () => {
    const { parsed } = await probe(fixture("{}", `{"cfg":{"mallNo":"AB-99"}}`));
    // Root attribution matters for judging a diagnostic: an inline SEO tag is weaker evidence than SPA state.
    expect(parsed?.hits).toEqual([{ key: "mallNo", value: "AB-99", root: "inline-json" }]);
  });

  it("refuses a number whose digits are already lost, rather than binding a rounded value", async () => {
    // Beyond 2^53 the parse has ALREADY rounded, so the string we could emit is not the store's id — it is
    // a near-miss that would digest to a stable, wrong fingerprint. `1e5` is a different case: 100000 is
    // exactly the id, and with page state now the only identity source there is no second reader to
    // disagree with.
    const { parsed } = await probe(
      fixture(`{"a":{"channelNo":12345678901234567890},"b":{"mallNo":1e5},"c":{"storeNo":"OK-123"}}`),
    );
    expect(parsed?.hits).toEqual([
      { key: "mallNo", value: "100000", root: "__PRELOADED_STATE__" },
      { key: "storeNo", value: "OK-123", root: "__PRELOADED_STATE__" },
    ]);
  });

  it("does not spend its hit budget on values it would discard anyway", async () => {
    // A free-text value can never become an identity, so counting it would report a truncated view of a
    // page we read in full — and truncation fails the run closed.
    const { parsed } = await probe(
      fixture(`{"a":{"channelNo":"a store name with spaces"},"b":{"mallNo":"AB99"}}`),
    );
    expect(parsed?.hits).toEqual([{ key: "mallNo", value: "AB99", root: "__PRELOADED_STATE__" }]);
    expect(parsed?.truncated).toBe(false);
  });

  it("reads NO page text, so customer-written review content cannot reach any gate", async () => {
    // The regression this exists for: an earlier version derived the session gates from marker words in the
    // page chrome. Widened enough to catch real seller headers, the scope also swept per-row card headers —
    // so a review body could supply the word the gate looked for. Fail-OPEN on the gate guarding a permanent
    // binding, and an undiagnosable run-killer in the other direction.
    const words = "\ub85c\uadf8\uc544\uc6c3 \uc2a4\ud1a0\uc5b4 \uc120\ud0dd \uc778\uc99d\ubc88\ud638";
    const { raw, parsed } = await probe(
      `<!doctype html><html><head><script>window.__PRELOADED_STATE__={"channelNo":"${CHANNEL_NO}"};</script></head>` +
        `<body><div class="item_header"><p>review: ${words}</p></div>` +
        `<header>${words}</header></body></html>`,
    );
    // The payload carries the identity and nothing else — no text, from chrome or content.
    expect(parsed?.hits).toEqual([{ key: "channelNo", value: CHANNEL_NO, root: "__PRELOADED_STATE__" }]);
    expect(raw).not.toContain(words.split(" ")[0]);
    expect(parsed?.rootsWalked).toBe(1);
  });

  it("fails closed when one key carries two different values", async () => {
    const { parsed } = await probe(
      fixture(`{"a":{"channelNo":"111111"},"b":{"channelNo":"222222"}}`),
    );
    expect(parsed!.hits.length).toBe(2);
    const { chosen, evidence } = chooseAccountIdentity({ hits: parsed!.hits, pinnedKey: PINNED });
    expect(chosen).toBeNull();
    expect(evidence.keysConflicting).toEqual(["channelNo"]);
  });

  it("survives a self-referential state object without hanging", async () => {
    body = fixture(`{"shop":{"channelNo":"${CHANNEL_NO}"}}`);
    await page.goto(`${base}?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<boolean>(
      `(() => { window.__PRELOADED_STATE__.self = window.__PRELOADED_STATE__; return true; })()`,
    );
    const raw = await (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<string>(
      inPageAccountIdentityProbe(),
    );
    expect(parseAccountProbeResult(raw)?.hits).toEqual([
      { key: "channelNo", value: CHANNEL_NO, root: "__PRELOADED_STATE__" },
    ]);
  });

  it("attributes each hit to the root that produced it, and lists the roots walked", async () => {
    // Load-bearing for the store-identity diagnostic: a key found in SPA state is very different evidence
    // from the same key in an SEO ld+json tag, and the operator has to be able to tell them apart.
    const { parsed } = await probe(
      fixture(`{"shop":{"channelNo":"${CHANNEL_NO}"}}`, `{"cfg":{"mallNo":"AB-99"}}`),
    );
    expect(parsed?.rootLabels).toEqual(["__PRELOADED_STATE__", "inline-json"]);
    expect(parsed?.hits).toEqual([
      { key: "channelNo", value: CHANNEL_NO, root: "__PRELOADED_STATE__" },
      { key: "mallNo", value: "AB-99", root: "inline-json" },
    ]);
  });

  it("leaves the DOM byte-identical — this probe has no legitimate mutation", async () => {
    body = fixture(`{"shop":{"channelNo":"${CHANNEL_NO}"}}`);
    await page.goto(`${base}?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
    const evaluate = (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate.bind(page);
    const before = await evaluate<string>(`document.documentElement.outerHTML`);
    await evaluate<string>(inPageAccountIdentityProbe());
    const after = await evaluate<string>(`document.documentElement.outerHTML`);
    expect(after).toBe(before);
  });
});
