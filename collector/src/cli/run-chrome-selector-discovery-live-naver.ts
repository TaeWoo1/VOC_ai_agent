/**
 * Live, GATED, human-attended **NAVER SELLER CHROME SELECTOR DISCOVERY** — READ-ONLY.
 *
 *   set -a && . ./.env && set +a
 *   npx tsx src/cli/run-chrome-selector-discovery-live-naver.ts -- --i-understand-this-inspects-live-naver-read-only
 *
 * The operator clicks the visible user-id element in the header/account chrome, then the visible shop-name
 * element in the sidebar/shop chrome. Both clicks are intercepted in the CAPTURE phase and cancelled, so
 * nothing on NAVER fires. The runtime derives bounded selector specifications FROM THE RETAINED ELEMENTS —
 * never by searching the document for their text — validates them, re-validates after a re-render the
 * OPERATOR causes, and stores the specifications.
 *
 * WHY THIS IS A SEPARATE CLI, and why it cannot bind. Selectors cannot be written by hand without having read
 * the surface, and guessing them is how three previous identity designs failed. Discovery therefore has to
 * happen; making it a distinct tool with no binding capability is what keeps "learn where to look" from
 * quietly becoming "decide who this is". There is no connection-store writer and no backend client anywhere
 * in this file's import graph.
 *
 * WHAT IT PERSISTS: selector SPECIFICATIONS only. The user id is read to check its shape and is never
 * printed, logged or stored — including INSIDE a selector: an account chip commonly carries an aria-label
 * or id containing the account name, so any candidate whose text embeds the value the element displays is
 * rejected during derivation rather than stored. The shop name is likewise not persisted here — that happens at bind time, in
 * the guided session, after an explicit confirmation.
 *
 * Exactly ONE `goto`, before the operator acts. The runtime never clicks, types, navigates or submits; the
 * only DOM effect is a marker attribute on the two picked elements, removed on teardown.
 */
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import {
  hasLiveRunApproval,
  hasNoIngest,
  hasReplyRunApproval,
  hasReviewIdProbeApproval,
  hasSessionRecovery,
  isClassifyOnly,
  mutatingFlagOnReadOnlyProbeMessage,
  selectorDiscoveryApprovalRequiredMessage,
  APPROVAL_FLAG,
  NO_INGEST_FLAG,
  REPLY_APPROVAL_FLAG,
  SESSION_RECOVERY_FLAG,
} from "./live-run-approval";
import {
  SELECTOR_PICKED,
  SELECTOR_PICK_TEARDOWN,
  SHOP_PICK_ATTRIBUTE,
  USER_PICK_ATTRIBUTE,
  armSelectorPick,
  deriveSelectorsFor,
  parseDeriveResult,
} from "../action-window/reply-submission/chrome-selector-derive-inpage";
import {
  rankCandidates,
  selectorSpecsFingerprint,
  specsCollide,
  withoutIdentityBearingSpecs,
  type ChromeSelectorSpecs,
  type SelectorSpec,
} from "../action-window/reply-submission/chrome-selector-spec";
import {
  defaultSelectorStorePath,
  saveSelectorSpecs,
} from "../action-window/reply-submission/chrome-selector-store";
import {
  inPageChromeIdentity,
  parseChromeIdentity,
} from "../action-window/reply-submission/chrome-identity-inpage";
import {
  normalizeShopName,
  normalizeUserId,
} from "../action-window/reply-submission/session-chrome-identity";

const READY_TIMEOUT_MS = 15 * 60_000;
const PICK_TIMEOUT_MS = 10 * 60_000;
const RERENDER_TIMEOUT_MS = 15 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

export const DISCOVERY_PRODUCTION_REFUSAL =
  "Refusing to inspect live NAVER under NODE_ENV=production.";

/** Which field a validated spec belongs to. */
export type ChromeField = "userId" | "shopName";

export function discoveryRefusal(
  args: string[],
  env: NodeJS.ProcessEnv,
): { reason: string; exitCode: number } | null {
  if (hasReplyRunApproval(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(REPLY_APPROVAL_FLAG), exitCode: 6 };
  }
  if (hasLiveRunApproval(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(APPROVAL_FLAG), exitCode: 6 };
  }
  if (hasNoIngest(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(NO_INGEST_FLAG), exitCode: 6 };
  }
  if (hasSessionRecovery(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(SESSION_RECOVERY_FLAG), exitCode: 6 };
  }
  if (isClassifyOnly(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage("--classify-only"), exitCode: 6 };
  }
  if (!hasReviewIdProbeApproval(args)) {
    return { reason: selectorDiscoveryApprovalRequiredMessage(), exitCode: 3 };
  }
  if (env.NODE_ENV === "production") {
    return { reason: DISCOVERY_PRODUCTION_REFUSAL, exitCode: 4 };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    if (typeof t.unref === "function") t.unref();
  });
}
function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}
async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  // Clear it FIRST. Clearing only at startup left a window in which a sentinel created
  // before its own step was already there when the step arrived — so the wait returned
  // immediately and the gate passed without the operator having done the thing. That is
  // exactly how the re-render check nearly accepted selectors proven only once.
  removeSentinel(path);
  for (let i = 0; i < Math.max(1, Math.ceil(timeoutMs / SENTINEL_POLL_INTERVAL_MS)); i += 1) {
    if (existsSync(path)) return true;
    await sleep(SENTINEL_POLL_INTERVAL_MS);
  }
  return false;
}
function evalOn<R>(page: Page, script: string): Promise<R> {
  return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

/**
 * Validate one candidate selector by READING through it exactly as the guided session
 * will, then applying the field's own shape check. A candidate that resolves but yields
 * a value the field would reject is not a usable selector, however stable it looks.
 */
async function validateSpec(
  page: Page,
  field: ChromeField,
  selector: string,
): Promise<string | null> {
  const userSel = field === "userId" ? [selector] : ["#__aw_never_matches"];
  const shopSel = field === "shopName" ? [selector] : ["#__aw_never_matches"];
  const parsed = parseChromeIdentity(await evalOn<string>(page, inPageChromeIdentity(userSel, shopSel)));
  if (!parsed) return null;
  const outcome = field === "userId" ? parsed.userId : parsed.shopName;
  if (outcome.value === null) return null;
  return field === "userId" ? normalizeUserId(outcome.value) : normalizeShopName(outcome.value);
}

/**
 * Does `selector` still resolve to the very element the operator picked?
 *
 * The pick markers are still on the DOM at re-render time (teardown runs in the `finally`), so this is
 * available — and it is the difference between "the selector still works" and "the selector still points
 * at what you chose". Shape-only re-validation accepts a WEAK positional selector that reflowed onto a
 * DIFFERENT element, because the replacement's text passes the same field check: `normalizeUserId` rejects
 * only empty/over-long/whitespace/control, so a Korean shop name with no space satisfies it. Persisting
 * that gives the guided session a userId spec that reads the shop name, and once the stronger candidate
 * ahead of it rots on a redeploy the fallback yields a composite of one value with itself.
 */
async function resolvesToPick(page: Page, selector: string, attribute: string): Promise<boolean> {
  const script = `(function(){
  var found = document.querySelectorAll(${JSON.stringify(selector)});
  if (found.length !== 1) { return false; }
  return found[0].hasAttribute(${JSON.stringify(attribute)});
})()`;
  return evalOn<boolean>(page, script).catch(() => false);
}

async function pickField(
  page: Page,
  attribute: string,
  prompt: string,
): Promise<boolean> {
  await evalOn<boolean>(page, armSelectorPick(attribute));
  console.error(prompt);
  for (let i = 0; i < Math.ceil(PICK_TIMEOUT_MS / SENTINEL_POLL_INTERVAL_MS); i += 1) {
    if (await evalOn<boolean>(page, SELECTOR_PICKED)) return true;
    await sleep(SENTINEL_POLL_INTERVAL_MS);
  }
  return false;
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" SELLER CHROME SELECTOR DISCOVERY — READ-ONLY. You click the two chrome elements; the runtime");
  console.error(" cancels pointerdown/mousedown/click in the capture phase, so the element's own handlers and");
  console.error(" the default action do NOT run. (Measured limit: a global capture listener the page installed");
  console.error(" before this run began still sees the event — nothing is bound or stored either way.)");
  console.error(" Selectors are derived from the elements themselves, never by searching for their text, then");
  console.error(" validated and re-validated after a re-render. It binds nothing and stores no identity value.");
  console.error(line);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  banner();
  const refusal = discoveryRefusal(args, process.env);
  if (refusal) {
    console.error(refusal.reason);
    process.exit(refusal.exitCode);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the seller-center page URL first.");
    process.exit(2);
    return;
  }

  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const storePath = defaultSelectorStorePath(collectorRoot);
  const statusDir = dirname(cfg.statusFile);
  mkdirSync(statusDir, { recursive: true });
  const readySentinel = resolve(statusDir, "selector-discovery-ready.ready");
  const rerenderSentinel = resolve(statusDir, "selector-rerendered.ready");
  removeSentinel(readySentinel);
  removeSentinel(rerenderSentinel);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  let activePage: Page = page;
  let accepted: ChromeSelectorSpecs | null = null;

  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });
    console.error(
      [
        "",
        "In the open browser: log in if needed and reach a seller-center page that shows BOTH your account",
        "id in the header and the current shop name in the shop selector.",
        `When both are visible, create:  ${readySentinel}`,
        "",
      ].join("\n"),
    );
    if (!(await waitForFile(readySentinel, READY_TIMEOUT_MS))) {
      console.error("No readiness signal; ending without discovering anything.");
      return;
    }
    removeSentinel(readySentinel);
    const openPages = ctx.pages();
    if (openPages.length === 0) {
      console.error("The browser page was closed — retry with the window open.");
      return;
    }
    activePage = openPages[openPages.length - 1] as Page;

    if (
      !(await pickField(
        activePage,
        USER_PICK_ATTRIBUTE,
        "\nNow CLICK your visible NAVER USER ID in the header/account area ONCE (intercepted — nothing fires)…",
      ))
    ) {
      console.error("No user-id element picked within the window; ending.");
      return;
    }
    if (
      !(await pickField(
        activePage,
        SHOP_PICK_ATTRIBUTE,
        "\nNow CLICK the visible CURRENT SHOP NAME in the sidebar/shop selector ONCE (intercepted)…",
      ))
    ) {
      console.error("No shop-name element picked within the window; ending.");
      return;
    }

    const derived: Record<ChromeField, SelectorSpec[]> = { userId: [], shopName: [] };
    const observed: Record<ChromeField, string | null> = { userId: null, shopName: null };
    for (const [field, attribute] of [
      ["userId", USER_PICK_ATTRIBUTE],
      ["shopName", SHOP_PICK_ATTRIBUTE],
    ] as [ChromeField, string][]) {
      const result = parseDeriveResult(await evalOn<string>(activePage, deriveSelectorsFor(attribute)));
      if (!result.ok) {
        console.error(`Could not derive selectors for ${field} (${result.reason}); ending.`);
        return;
      }
      const ranked = rankCandidates(result.candidates);
      const valid: SelectorSpec[] = [];
      for (const spec of ranked) {
        const value = await validateSpec(activePage, field, spec.selector);
        if (value === null) continue;
        observed[field] = value;
        valid.push(spec);
      }
      console.error(
        `  ${field.padEnd(9)} derived ${ranked.length}, valid ${valid.length}` +
          (valid.length > 0 ? ` (best: ${valid[0]!.strategy}, ${valid[0]!.stability})` : ""),
      );
      derived[field] = valid;
    }

    // NODE-SIDE IDENTITY-LEAK GUARD, and the only authoritative one.
    //
    // Derivation has an in-page check, but it runs where the page can see it, it knows only the field it
    // was called for, and it asked the containment question backwards — "does this attribute contain the
    // element's ENTIRE rendered text", which never fires once the chrome decorates the value ("<id>님",
    // "<id> 계정", a trailing caret span). This asks the question that matters — is the VALUE inside the
    // SELECTOR — against BOTH fields' observed values, so a user id cannot ride out inside the shop-name
    // spec either. Rejections are reported, never silently dropped: a field emptied by this guard must end
    // the run, because storing "the remaining ones" would quietly downgrade a calibration the operator
    // believes succeeded.
    for (const field of ["userId", "shopName"] as ChromeField[]) {
      const { kept, rejected } = withoutIdentityBearingSpecs(derived[field], [
        observed.userId,
        observed.shopName,
      ]);
      if (rejected > 0) {
        console.error(
          `  ${field.padEnd(9)} rejected ${rejected} selector(s) that embedded an observed identity value.`,
        );
      }
      derived[field] = kept;
    }

    if (derived.userId.length === 0 || derived.shopName.length === 0) {
      console.error("");
      console.error("At least one field produced no usable selector. Nothing is stored.");
      console.error("A selector is usable only if it resolves to exactly one element, sits outside any");
      console.error("table/grid/row/article/list content region, holds bounded text, and passes the field's");
      console.error("shape check. Try clicking a tighter element (the value itself, not its container).");
      return;
    }

    const candidateSpecs: ChromeSelectorSpecs = {
      userId: derived.userId,
      shopName: derived.shopName,
    };
    if (specsCollide(candidateSpecs)) {
      // The same element for both fields would produce a composite of one value with
      // itself — which looks like a perfectly stable identity and identifies nothing.
      console.error("");
      console.error("The two fields resolved to the SAME element. Nothing is stored — re-run and click the");
      console.error("account id and the shop name separately.");
      return;
    }

    // RE-RENDER CHECK. A selector that works once may be positional or tied to a
    // transient node; the operator causes a re-render (the runtime never does) and every
    // spec is validated again. Anything that stops resolving is dropped, not kept.
    console.error(
      [
        "",
        "Now cause a RE-RENDER of the chrome yourself — switch a menu, collapse/expand the sidebar, or",
        "resize the window. Do NOT navigate away. This checks the selectors survive a redraw.",
        `When done, create:  ${rerenderSentinel}`,
        "",
      ].join("\n"),
    );
    if (!(await waitForFile(rerenderSentinel, RERENDER_TIMEOUT_MS))) {
      console.error("No re-render signal; nothing is stored (a selector proven once is not proven).");
      return;
    }
    removeSentinel(rerenderSentinel);

    const survived: ChromeSelectorSpecs = { userId: [], shopName: [] };
    for (const [field, attribute] of [
      ["userId", USER_PICK_ATTRIBUTE],
      ["shopName", SHOP_PICK_ATTRIBUTE],
    ] as [ChromeField, string][]) {
      let drifted = 0;
      for (const spec of candidateSpecs[field]) {
        const value = await validateSpec(activePage, field, spec.selector);
        if (value === null) continue;
        // Survival is THREE things, not one. Shape alone lets a reflowed positional selector survive by
        // landing on a different element whose text happens to satisfy the same field check.
        if (value !== observed[field] || !(await resolvesToPick(activePage, spec.selector, attribute))) {
          drifted += 1;
          continue;
        }
        survived[field].push(spec);
      }
      console.error(
        `  ${field.padEnd(9)} survived re-render: ${survived[field].length}/${candidateSpecs[field].length}` +
          (drifted > 0 ? ` (${drifted} resolved to a DIFFERENT element or value — dropped)` : ""),
      );
    }
    if (survived.userId.length === 0 || survived.shopName.length === 0) {
      console.error("");
      console.error("A field lost every selector across the re-render. Nothing is stored.");
      return;
    }
    accepted = survived;
  } finally {
    for (const p of ctx.pages()) {
      await evalOn<number>(p as Page, SELECTOR_PICK_TEARDOWN).catch(() => undefined);
    }
    removeSentinel(readySentinel);
    removeSentinel(rerenderSentinel);
    await ctx.close();
  }

  if (!accepted) {
    console.error("\nDiscovery did not complete. Nothing was stored and nothing was bound.");
    process.exitCode = 2;
    return;
  }

  saveSelectorSpecs(storePath, accepted);
  const fingerprint = selectorSpecsFingerprint(accepted);
  log("aw.chrome-selectors.discovered", {
    userIdSpecs: accepted.userId.length,
    shopNameSpecs: accepted.shopName.length,
    weakOnly:
      accepted.userId.every((s) => s.stability === "weak") ||
      accepted.shopName.every((s) => s.stability === "weak"),
  });

  console.log(
    JSON.stringify(
      {
        specs: accepted,
        selectorSpecsFingerprint: fingerprint,
        boundAnything: false,
        persistedIdentityValue: false,
      },
      null,
      2,
    ),
  );
  console.error("");
  console.error("Selectors stored. NOTHING was bound and no identity value was written.");
  if (
    accepted.userId.every((s) => s.stability === "weak") ||
    accepted.shopName.every((s) => s.stability === "weak")
  ) {
    console.error("! every surviving selector for at least one field is WEAK (class- or position-derived).");
    console.error("  It will work now and is likely to rot on a redeploy; re-run discovery if it does.");
  }
  console.error("STOP. The guided session is a separate run and needs its own gate.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e: unknown) => {
    const category = e instanceof Error ? e.constructor.name : typeof e;
    console.error(`Selector discovery failed (${category}). Details are suppressed to keep the run sanitized.`);
    process.exitCode = 1;
  });
}
