/**
 * Boundary proofs for the ISOLATED API-issuance runtime:
 *  - a SOURCE GUARD that no issuance module can click/type/submit or read a field VALUE (incl. the
 *    Application ID / Secret), mirroring the reply/import purity guards (comment lines stripped first);
 *  - the candidate adapter stays UNVERIFIED — every new rule carries `LIVE_DOM_CALIBRATION_PENDING`;
 *  - the synthetic fixtures carry the candidate `[data-aw-target]` markers and the expected structural shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  LIVE_DOM_CALIBRATION_PENDING,
  branchAfterProbe,
  classifyAppListPopulation,
  CANDIDATE_TARGET_SELECTORS,
  pageCategoryFromCensus,
} from "../../../src/action-window/api-issuance/api-center-adapter";
import { IssuanceEngine, makeIssuanceClock } from "../../../src/action-window/api-issuance/issuance-engine";
import { validateEventEnvelope } from "../../../../contracts/action-window/v2/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../../src/action-window/api-issuance");
const ENDPOINT = resolve(HERE, "../../../src/bridge/api-issuance-endpoint.ts");
const FIXTURES = resolve(HERE, "../../../fixtures");

/** Strip block comments and comment/JSDoc lines so prose mentioning a forbidden token never trips. */
function codeOnly(path: string): string {
  const raw = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return raw
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

/**
 * auto click / submit = 0 — no way to act on a marketplace control.
 *
 * Includes the general "run anything in the page" primitives (`.evaluate` / `.$eval` / `.$$eval`): those
 * can click OR read a value, so they are forbidden outright — the live driver observes and annotates only.
 */
const NO_CLICK_TOKENS = [
  ".click(",
  ".dblclick(",
  ".tap(",
  ".hover(",
  ".type(",
  ".fill(",
  ".press(",
  ".check(",
  ".uncheck(",
  ".selectOption(",
  ".setInputFiles(",
  ".keyboard",
  "dispatchEvent",
  ".submit(",
  ".evaluate(",
  ".evaluateHandle(",
  ".$eval(",
  ".$$eval(",
  'waitForEvent("download"',
  "waitForEvent('download'",
] as const;

/**
 * Secret DOM read = 0 — no way to read a field value, attribute, text, clipboard, or screenshot.
 *
 * This is the structural promise the whole safety story rests on — it must reject a READ, not only a write,
 * so it also guards the not-yet-written live driver: a bare `.value` (read), `getAttribute`, `innerText` /
 * `innerHTML`, `getProperty`, `.content(`, and `.textContent` are all forbidden. Widened after the
 * independent review flagged that catching only `.value =` (write) let a `node.value` read slip through.
 */
const NO_VALUE_READ_TOKENS = [
  ".inputValue(",
  ".value", // a bare read (`node.value`) OR a write (`x.value =`) — both forbidden.
  "= el.value",
  ".textContent",
  ".innerText",
  ".innerHTML",
  ".getAttribute(",
  ".getProperty(",
  ".getProperties(",
  ".content(",
  "clipboard",
  "readText(",
  ".screenshot(",
] as const;

function issuanceModules(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) files[f] = resolve(SRC, f);
  files["bridge/api-issuance-endpoint.ts"] = ENDPOINT;
  return files;
}

describe("issuance runtime — source guard: auto click/submit = 0", () => {
  for (const [name, path] of Object.entries(issuanceModules())) {
    const code = codeOnly(path);
    it.each(NO_CLICK_TOKENS)(`${name} never contains %s`, (token) => {
      expect(code).not.toContain(token);
    });
  }
});

describe("issuance runtime — source guard: Secret DOM read = 0", () => {
  for (const [name, path] of Object.entries(issuanceModules())) {
    const code = codeOnly(path);
    it.each(NO_VALUE_READ_TOKENS)(`${name} never reads a field value / clipboard / screenshot (%s)`, (token) => {
      expect(code).not.toContain(token);
    });
  }

  it("the adapter and driver surface only counts/booleans/opaque sigs — never a value read", () => {
    // Structural proof: the adapter's application-population rule is derived from a COUNT, and its output is
    // a coarse bucket + verdict enum + calibration marker. No value, name, or id is present.
    const out = classifyAppListPopulation(2);
    expect(out.population).toBe("existing");
    expect(out.entryRowCountBucket).toBe("few");
    expect(Object.keys(out).sort()).toEqual(["calibration", "entryRowCountBucket", "population"]);
    expect(classifyAppListPopulation(0).population).toBe("empty");
  });
});

describe("issuance engine — a non-opaque locate signature can never become a targetRef", () => {
  const CENSUS = {
    passwordFieldPresent: false,
    submitAffordancePresent: false,
    formCount: 0,
    editableTextInputCount: 0,
    readonlyFieldCount: 0,
    listLikeContainerCount: 1,
  };

  it("parks target_not_found on a raw-value sig, and never emits that value on the wire", () => {
    const RAW = "raw-secret-value-1234"; // exactly what a mis-written live driver might return as a "sig"
    const eng = new IssuanceEngine({ runId: "r", channelCode: "naver" }, { clock: makeIssuanceClock() });
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "app_list" });
    eng.onApplicationsRead({ census: CENSUS, applicationEntryRowCount: 1 }); // existing → guide open_app
    eng.onTargetLocated("open_app", { count: 1, sig: RAW });

    // Fail closed at the barrier — never highlighted.
    expect(eng.currentStage()).toBe("target_not_found");
    // The raw value never appears anywhere in the emitted event stream…
    for (const e of eng.events()) expect(JSON.stringify(e)).not.toContain(RAW);
    // …and every emitted event is still contract-valid (a non-hex targetRef would have failed this).
    for (const e of eng.events()) expect(validateEventEnvelope(e).ok).toBe(true);
  });
});

describe("issuance adapter — stays UNVERIFIED (every rule carries LIVE_DOM_CALIBRATION_PENDING)", () => {
  it("the population rule reports the calibration caveat", () => {
    expect(classifyAppListPopulation(1).calibration).toBe(LIVE_DOM_CALIBRATION_PENDING);
  });

  it("the probe-branch rule reports the calibration caveat, and fails closed off-target", () => {
    expect(branchAfterProbe("login")).toEqual({ branch: "login", calibration: LIVE_DOM_CALIBRATION_PENDING });
    expect(branchAfterProbe("app_list").branch).toBe("app_list");
    // Anything the tutorial did not expect → page_mismatch (fail-closed, never a guess onward).
    for (const cat of ["app_detail", "credential_issuance", "unknown"] as const) {
      expect(branchAfterProbe(cat).branch).toBe("page_mismatch");
    }
  });

  it("delegates page classification to observe-api-center, which stamps the same calibration caveat", () => {
    // A login census → login category (delegated to the reused classifier).
    const { pageCategory } = pageCategoryFromCensus("api_center_host", {
      passwordFieldPresent: true,
      submitAffordancePresent: true,
      formCount: 1,
      editableTextInputCount: 1,
      readonlyFieldCount: 0,
      listLikeContainerCount: 0,
    });
    expect(pageCategory).toBe("login");
  });

  it("the CANDIDATE selector map is DATA (opaque to the wire) and covers every target", () => {
    expect(Object.keys(CANDIDATE_TARGET_SELECTORS).sort()).toEqual(["api_group", "application_id", "application_secret", "create_app", "open_app", "return"]);
    for (const sel of Object.values(CANDIDATE_TARGET_SELECTORS)) expect(sel).toContain("data-aw-target");
  });
});

describe("issuance fixtures — carry the candidate markers and the expected structural shape", () => {
  const read = (f: string) => readFileSync(resolve(FIXTURES, f), "utf8");

  it("login fixture has a password input (→ login category)", () => {
    expect(read("apicenter_login.html")).toContain('type="password"');
  });

  it("empty app-list has no application-entry row and offers the create_app control", () => {
    const html = read("apicenter_app_list_empty.html");
    expect(html).toContain('data-aw-target="create_app"');
    expect(html).not.toContain("app-entry");
  });

  it("existing app-list has ≥1 entry row and offers the open_app control", () => {
    const html = read("apicenter_app_list_existing.html");
    expect(html).toContain('data-aw-target="open_app"');
    expect(html).toContain("app-entry");
  });

  it("app-detail fixtures are editable (→ app_detail) and offer the api_group control", () => {
    for (const f of ["apicenter_app_detail_no_group.html", "apicenter_app_detail_with_group.html"]) {
      const html = read(f);
      expect(html).toContain('data-aw-target="api_group"');
      expect(html).toContain('type="text"');
    }
    // The no-group variant has an empty group section; the with-group variant lists groups.
    expect(read("apicenter_app_detail_no_group.html")).toContain('<section class="api-groups"></section>');
    expect(read("apicenter_app_detail_with_group.html")).toContain("<li>커머스 API</li>");
  });

  it("credentials fixture DISPLAYS readonly fields (never read) and offers credentials + return controls", () => {
    const html = read("apicenter_credentials.html");
    expect(html).toContain("readonly");
    expect(html).toContain('data-aw-target="credentials"');
    expect(html).toContain('data-aw-target="return"');
  });

  it("off-target fixture has no password/readonly/editable/list markers (→ unknown → page_mismatch)", () => {
    const html = read("apicenter_offtarget.html");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("readonly");
    expect(html).not.toContain("data-aw-target");
  });
});
