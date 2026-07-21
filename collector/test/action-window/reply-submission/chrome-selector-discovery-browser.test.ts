/**
 * **Selector-discovery real-DOM rung (RUN_INTEGRATION=1; headless, localhost fixture).**
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/reply-submission/chrome-selector-discovery-browser.test.ts
 *
 * Derivation walks UP from the element the operator clicked. That is the property that makes it safe where
 * three deleted text sources were not — a search finds every copy of a value including one a customer wrote,
 * while a walk from a retained node cannot reach a node the customer chose. It is DOM behaviour, so it is
 * proven in a DOM.
 *
 * Fixtures are seller-shell-*shaped*, with no marketplace trademark or markup, and plant a review row that
 * reproduces both identity values verbatim.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import {
  SELECTOR_PICKED,
  SELECTOR_PICK_TEARDOWN,
  SHOP_PICK_ATTRIBUTE,
  USER_PICK_ATTRIBUTE,
  armSelectorPick,
  deriveSelectorsFor,
  parseDeriveResult,
} from "../../../src/action-window/reply-submission/chrome-selector-derive-inpage";
import {
  rankCandidates,
  specsCollide,
  type ChromeSelectorSpecs,
} from "../../../src/action-window/reply-submission/chrome-selector-spec";
import {
  inPageChromeIdentity,
  parseChromeIdentity,
} from "../../../src/action-window/reply-submission/chrome-identity-inpage";

const RUN = process.env.RUN_INTEGRATION === "1";

const USER = "seller_alpha";
const SHOP = "알파 스토어";

let server: http.Server;
let browser: Browser;
let page: Page;
let base: string;
let body = "";

function shell(inner: string): string {
  return `<!doctype html><html><head><title>shell</title></head><body>${inner}</body></html>`;
}

/** A review row reproducing BOTH values verbatim, in identically-classed nodes, inside a table. */
const HOSTILE = `
<table><tbody><tr><td>
  <div class="user-id">${USER}</div><div class="shop-name">${SHOP}</div>
  <p>이 판매자 ${USER} 의 ${SHOP} 에서 샀어요</p>
</td></tr></tbody></table>`;

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

function evaluate<T>(s: string): Promise<T> {
  return (page as unknown as { evaluate<R>(x: string): Promise<R> }).evaluate<T>(s);
}

async function load(html: string): Promise<void> {
  body = html;
  await page.goto(`${base}?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
}

/** Simulate the operator's click through a real capture-phase event. */
async function pick(attribute: string, cssToClick: string): Promise<boolean> {
  await evaluate<boolean>(armSelectorPick(attribute));
  await page.click(cssToClick);
  return evaluate<boolean>(SELECTOR_PICKED);
}

async function derive(attribute: string) {
  return parseDeriveResult(await evaluate<string>(deriveSelectorsFor(attribute)));
}

async function readThrough(userSel: string[], shopSel: string[]) {
  return parseChromeIdentity(await evaluate<string>(inPageChromeIdentity(userSel, shopSel)));
}

describe.runIf(RUN)("selector discovery — real DOM", () => {
  it("captures the click in the capture phase without activating the element", async () => {
    // The element is an anchor with an onclick that would navigate; if the interception
    // leaked, `window.__fired` would be true and the hash would have changed.
    await load(
      shell(`<header id="gnb"><a id="uid" href="#gone" onclick="window.__fired=true">${USER}</a></header>`),
    );
    expect(await pick(USER_PICK_ATTRIBUTE, "#uid")).toBe(true);
    expect(await evaluate<boolean>(`window.__fired === true`)).toBe(false);
    expect(await evaluate<string>(`location.hash`)).toBe("");
  });

  it("derives a strong id selector and prefers it over positional ones", async () => {
    await load(shell(`<header id="gnb"><span id="account-id">${USER}</span></header>`));
    await pick(USER_PICK_ATTRIBUTE, "#account-id");
    const result = await derive(USER_PICK_ATTRIBUTE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ranked = rankCandidates(result.candidates);
    expect(ranked[0]!.strategy).toBe("element-id");
    expect(ranked[0]!.stability).toBe("strong");
    expect(ranked[0]!.selector).toBe("#account-id");
  });

  it("treats generated class names and ids as unusable, falling back to weaker strategies", async () => {
    await load(shell(`<header id="gnb"><span id="x9f3a81c02b" class="css-1a2b3c4">${USER}</span></header>`));
    await pick(USER_PICK_ATTRIBUTE, "span");
    const result = await derive(USER_PICK_ATTRIBUTE);
    if (!result.ok) throw new Error("expected candidates");
    const ranked = rankCandidates(result.candidates);
    // The hashed id and the generated class are both rejected, so nothing id-based
    // survives — what remains is ancestry/positional, labelled accordingly.
    expect(ranked.every((s) => s.selector !== "#x9f3a81c02b")).toBe(true);
    expect(ranked.length).toBeGreaterThan(0);
  });

  it("THE ONE: derivation from the clicked element ignores a review row with identical text", async () => {
    await load(
      shell(
        `<header id="gnb"><span id="account-id">${USER}</span></header>` +
          `<aside id="shop"><span id="shop-name">${SHOP}</span></aside>` +
          HOSTILE,
      ),
    );
    await pick(USER_PICK_ATTRIBUTE, "#account-id");
    await pick(SHOP_PICK_ATTRIBUTE, "#shop-name");
    const u = await derive(USER_PICK_ATTRIBUTE);
    const s = await derive(SHOP_PICK_ATTRIBUTE);
    if (!u.ok || !s.ok) throw new Error("expected candidates");

    const specs: ChromeSelectorSpecs = {
      userId: rankCandidates(u.candidates),
      shopName: rankCandidates(s.candidates),
    };
    expect(specsCollide(specs)).toBe(false);

    const read = await readThrough(
      specs.userId.map((x) => x.selector),
      specs.shopName.map((x) => x.selector),
    );
    expect(read?.userId.value?.trim()).toBe(USER);
    expect(read?.shopName.value?.trim()).toBe(SHOP);
  });

  it("every derived candidate already resolves to exactly the picked element", async () => {
    // Derivation self-verifies before returning, so a candidate that would also match the
    // review row is never emitted in the first place.
    await load(shell(`<header id="gnb"><span class="user-id">${USER}</span></header>` + HOSTILE));
    await pick(USER_PICK_ATTRIBUTE, "header .user-id");
    const result = await derive(USER_PICK_ATTRIBUTE);
    if (!result.ok) throw new Error("expected candidates");
    for (const c of result.candidates) {
      const count = await evaluate<number>(
        `document.querySelectorAll(${JSON.stringify(c.selector)}).length`,
      );
      expect(count, c.selector).toBe(1);
    }
    // A bare `.user-id` is ambiguous with the review row, so it must NOT appear.
    expect(result.candidates.some((c) => c.selector === ".user-id")).toBe(false);
  });

  it("reports a missing pick rather than deriving from nothing", async () => {
    await load(shell(`<header id="gnb"><span>${USER}</span></header>`));
    const result = await derive(USER_PICK_ATTRIBUTE);
    expect(result).toEqual({ ok: false, reason: "no-pick" });
  });

  it("a re-render breaks WEAK selectors while structural ones survive — which is what stability means", async () => {
    await load(shell(`<header id="gnb"><span class="a">${USER}</span></header>`));
    await pick(USER_PICK_ATTRIBUTE, "header .a");
    const result = await derive(USER_PICK_ATTRIBUTE);
    if (!result.ok) throw new Error("expected candidates");
    const before = rankCandidates(result.candidates);
    expect(before.length).toBeGreaterThan(0);

    // The SPA re-renders the header with a different class — the calibrated selectors
    // stop resolving, which is exactly what the discovery re-render check exists to catch.
    await evaluate<boolean>(
      `(() => { document.getElementById('gnb').textContent = ''; var s = document.createElement('span'); s.className='b'; s.textContent=${JSON.stringify(USER)}; document.getElementById('gnb').appendChild(s); return true; })()`,
    );
    const survivors: typeof before = [];
    for (const spec of before) {
      const read = await readThrough([spec.selector], ["#__never"]);
      if (read?.userId.value !== null) survivors.push(spec);
    }
    // The class-derived candidate is gone; the structural one still resolves. That
    // asymmetry is exactly what `stability` records, and why discovery keeps the whole
    // ranked list rather than only its first entry.
    expect(before.some((s) => s.selector.includes(".a"))).toBe(true);
    expect(survivors.some((s) => s.selector.includes(".a"))).toBe(false);
    expect(survivors.length).toBeGreaterThan(0);
  });

  it("drops every selector when the picked element disappears entirely", async () => {
    // The case the discovery re-render gate exists for: nothing survived, so nothing is
    // stored rather than storing a selector proven exactly once.
    await load(shell(`<header id="gnb"><span class="a">${USER}</span></header>`));
    await pick(USER_PICK_ATTRIBUTE, "header .a");
    const result = await derive(USER_PICK_ATTRIBUTE);
    if (!result.ok) throw new Error("expected candidates");
    const before = rankCandidates(result.candidates);

    await evaluate<boolean>(
      `(() => { document.getElementById('gnb').textContent = ''; return true; })()`,
    );
    const survivors: string[] = [];
    for (const spec of before) {
      const read = await readThrough([spec.selector], ["#__never"]);
      if (read?.userId.value !== null) survivors.push(spec.selector);
    }
    expect(survivors).toEqual([]);
  });

  it("cancels a control that activates on POINTERDOWN, not only on click", async () => {
    // `click` alone was not enough. A control that acts on pointerdown/mousedown has already run by the
    // time click arrives, so cancelling click does not undo it — while the operator is told nothing on
    // NAVER fires. The interceptor now cancels the whole sequence.
    await load(
      shell(
        `<header id="gnb"><button id="uid"
           onpointerdown="window.__pd=true" onmousedown="window.__md=true" onclick="window.__ck=true"
         >${USER}</button></header>`,
      ),
    );
    expect(await pick(USER_PICK_ATTRIBUTE, "#uid")).toBe(true);
    expect(await evaluate<boolean>(`window.__pd === true`)).toBe(false);
    expect(await evaluate<boolean>(`window.__md === true`)).toBe(false);
    expect(await evaluate<boolean>(`window.__ck === true`)).toBe(false);
  });

  it("KNOWN LIMIT: a window capture listener registered BEFORE arming still runs", async () => {
    // Recorded as a measured limit rather than claimed as a fix, because it cannot be fixed by
    // registration. Same target, same phase, listeners run in REGISTRATION order — a page listener that
    // was already on `window` when we armed runs first, and `stopImmediatePropagation` cannot reach
    // backwards to a listener that has already run. Registering on window still helps for the commoner
    // case (a listener attached after arming, e.g. by an SPA re-render), which the next assertion pins.
    //
    // The operator-facing consequence, stated plainly: "nothing on NAVER fires" is true of the element's
    // own handlers and of the default action, NOT of a pre-existing global capture listener. If NAVER
    // ever ships one, discovery would trip it. Nothing is bound or persisted as a result — this is a
    // read-only calibration run — but the banner would be overstating.
    await load(
      shell(
        `<script>window.addEventListener('pointerdown', function(){ window.__early = true; }, true);</script>
         <header id="gnb"><button id="uid">${USER}</button></header>`,
      ),
    );
    expect(await pick(USER_PICK_ATTRIBUTE, "#uid")).toBe(true);
    expect(await evaluate<boolean>(`window.__early === true`)).toBe(true);
    // The pick still succeeds and the DEFAULT action is still cancelled, which is what protects the page.
    expect(await evaluate<string>(`location.hash`)).toBe("");
  });

  it("does beat a listener attached AFTER arming, on window or on document", async () => {
    await load(shell(`<header id="gnb"><button id="uid">${USER}</button></header>`));
    await evaluate<boolean>(armSelectorPick(USER_PICK_ATTRIBUTE));
    await evaluate<boolean>(
      `(() => {
         window.addEventListener('pointerdown', () => { window.__late = true; }, true);
         document.addEventListener('click', () => { window.__lateDoc = true; }, true);
         return true;
       })()`,
    );
    await page.click("#uid");
    expect(await evaluate<boolean>(SELECTOR_PICKED)).toBe(true);
    expect(await evaluate<boolean>(`window.__late === true`)).toBe(false);
    expect(await evaluate<boolean>(`window.__lateDoc === true`)).toBe(false);
  });

  it("never emits a selector embedding the displayed value, however the chrome decorates it", async () => {
    // THE REGRESSION THIS EXISTS FOR. The guard asked "does the attribute contain the element's ENTIRE
    // text", which fires only when the element renders the bare value. Real chrome decorates it, so
    // `shown` was "seller_alpha님" and `aria-label="seller_alpha 계정 메뉴"` did not contain it: the
    // account name was emitted as a STRONG aria-label spec, printed to stdout and persisted to a file
    // whose entire promise is that it holds locations, not identities.
    await load(
      shell(
        `<header id="gnb"><button id="acct_${USER}" data-testid="acct-${USER}-menu"
           aria-label="${USER} 계정 메뉴"><span>${USER}</span><span>님</span></button></header>`,
      ),
    );
    await pick(USER_PICK_ATTRIBUTE, `#acct_${USER}`);
    const result = await derive(USER_PICK_ATTRIBUTE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const candidate of result.candidates) {
      expect(candidate.selector, `leaked via ${candidate.strategy}`).not.toContain(USER);
    }
  });

  it("teardown removes every marker attribute", async () => {
    await load(shell(`<header id="gnb"><span id="a">${USER}</span><span id="b">${SHOP}</span></header>`));
    await pick(USER_PICK_ATTRIBUTE, "#a");
    await pick(SHOP_PICK_ATTRIBUTE, "#b");
    expect(await evaluate<number>(SELECTOR_PICK_TEARDOWN)).toBe(2);
    expect(await evaluate<number>(`document.querySelectorAll('[${USER_PICK_ATTRIBUTE}]').length`)).toBe(0);
    expect(await evaluate<number>(`document.querySelectorAll('[${SHOP_PICK_ATTRIBUTE}]').length`)).toBe(0);
  });
});
