/**
 * Read-only API-center observation harness — offline/synthetic tests (G3-C.2). Importing the module
 * launches nothing (`main()` runs only when invoked directly). Every assertion is offline: no live NAVER,
 * no browser, no disk. Proves the harness is counts/booleans/enums only, that it never surfaces a value or
 * raw URL, that classification is structural + fail-closed, and that it always flags itself as an
 * unvalidated (calibration-pending) instrument.
 */
import { describe, it, expect, vi } from "vitest";
import {
  EXTRACT_API_CENTER_CENSUS,
  classifyApiCenterPage,
  classifyUrlCategory,
  countBucket,
  observeApiCenter,
  observeApiCenterManualNavigation,
  observeFrom,
  observeSentinelPathFor,
  resolveUrlCategory,
  screenApiCenterUrl,
  toSignals,
  type ApiCenterStructuralCensus,
} from "../../src/cli/observe-api-center";

function census(o: Partial<ApiCenterStructuralCensus> = {}): ApiCenterStructuralCensus {
  return {
    passwordFieldPresent: false,
    submitAffordancePresent: false,
    formCount: 0,
    editableTextInputCount: 0,
    readonlyFieldCount: 0,
    listLikeContainerCount: 0,
    ...o,
  };
}

describe("classifyUrlCategory — host category, never the raw URL", () => {
  it("maps the named API-center host and the canonical login host", () => {
    expect(classifyUrlCategory("https://apicenter.commerce.naver.com/ko/some/path?q=1")).toBe("api_center_host");
    expect(classifyUrlCategory("https://nid.naver.com/nidlogin.login")).toBe("naver_auth_host");
    expect(classifyUrlCategory("https://sub.nid.naver.com/x")).toBe("naver_auth_host");
  });

  it("treats any other host as other_host and unparseable input as unknown (fail-closed)", () => {
    expect(classifyUrlCategory("https://example.com/apicenter")).toBe("other_host");
    expect(classifyUrlCategory("not a url")).toBe("unknown");
  });

  it("resolveUrlCategory prefers an explicit category and never requires the URL", () => {
    expect(resolveUrlCategory({ category: "api_center_host" })).toBe("api_center_host");
    expect(resolveUrlCategory({ url: "https://apicenter.commerce.naver.com/x" })).toBe("api_center_host");
    expect(resolveUrlCategory({})).toBe("unknown");
  });
});

describe("countBucket", () => {
  it("buckets by ≤0 / ≤3 / else", () => {
    expect(countBucket(0)).toBe("none");
    expect(countBucket(3)).toBe("few");
    expect(countBucket(4)).toBe("many");
  });
});

describe("classifyApiCenterPage — structural, fail-closed, always calibration-pending", () => {
  const onTarget = (c: Partial<ApiCenterStructuralCensus>) => toSignals("api_center_host", census(c));

  it("always reports LIVE_DOM_CALIBRATION_PENDING (never a proven detector)", () => {
    const r = classifyApiCenterPage(onTarget({ passwordFieldPresent: true, submitAffordancePresent: true }));
    expect(r.blockers).toContain("LIVE_DOM_CALIBRATION_PENDING");
  });

  it("login = password field present (wins over an incidental id input or list — precedence)", () => {
    expect(classifyApiCenterPage(onTarget({ passwordFieldPresent: true, submitAffordancePresent: true, formCount: 1 })).pageCategory).toBe("login");
    // Precedence: a password page also carrying an editable id input and even a list still classifies login.
    expect(classifyApiCenterPage(onTarget({ passwordFieldPresent: true, editableTextInputCount: 1, listLikeContainerCount: 5 })).pageCategory).toBe("login");
  });

  it("app_list = list container, no password", () => {
    const r = classifyApiCenterPage(onTarget({ listLikeContainerCount: 2 }));
    expect(r.pageCategory).toBe("app_list");
  });

  it("credential_issuance = read-only fields shown, no list, no password", () => {
    const r = classifyApiCenterPage(onTarget({ readonlyFieldCount: 2 }));
    expect(r.pageCategory).toBe("credential_issuance");
  });

  it("app_detail = editable inputs, no read-only display, no list, no password", () => {
    const r = classifyApiCenterPage(onTarget({ editableTextInputCount: 3, formCount: 1 }));
    expect(r.pageCategory).toBe("app_detail");
  });

  it("off-target host → unknown + OFF_TARGET_HOST (refuse to classify)", () => {
    const r = classifyApiCenterPage(toSignals("other_host", census({ passwordFieldPresent: true, submitAffordancePresent: true })));
    expect(r.pageCategory).toBe("unknown");
    expect(r.blockers).toContain("OFF_TARGET_HOST");
  });

  it("no signal → unknown + AMBIGUOUS_SIGNALS (fail-closed)", () => {
    const r = classifyApiCenterPage(onTarget({}));
    expect(r.pageCategory).toBe("unknown");
    expect(r.blockers).toContain("AMBIGUOUS_SIGNALS");
  });

  it("precedence: read-only display wins over editable inputs (issued values shown)", () => {
    const r = classifyApiCenterPage(onTarget({ readonlyFieldCount: 2, editableTextInputCount: 2 }));
    expect(r.pageCategory).toBe("credential_issuance");
  });
});

describe("screenApiCenterUrl — pre-launch fail-closed gate", () => {
  it("accepts the API-center and NAVER auth hosts", () => {
    expect(screenApiCenterUrl("https://apicenter.commerce.naver.com/ko/x")).toEqual({ ok: true, reason: "ok", urlCategory: "api_center_host" });
    expect(screenApiCenterUrl("https://nid.naver.com/nidlogin.login").ok).toBe(true);
  });

  it("rejects a bare placeholder token before any navigation (invalid — not a URL)", () => {
    // The first failed live run passed the literal env-var name; it must never reach page.navigate.
    const r = screenApiCenterUrl("NAVER_API_CENTER_URL");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("placeholder"); // caught as placeholder (no "://")
  });

  it("rejects placeholder-shaped values", () => {
    for (const bad of ["https://your-store.example.com/api", "https://example.com/apicenter", "<put-url-here>", "https://changeme.naver.com"]) {
      expect(screenApiCenterUrl(bad).ok).toBe(false);
    }
  });

  it("rejects an off-target host (e.g. the seller-center review page) — the second failed run's mistake", () => {
    const r = screenApiCenterUrl("https://sell.smartstore.naver.com/#/reviews");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("off_target");
  });
});

describe("EXTRACT_API_CENTER_CENSUS — browser-context safe (regression for the __name evaluate bug)", () => {
  it("is a string with no esbuild/tsx helper reference", () => {
    expect(typeof EXTRACT_API_CENTER_CENSUS).toBe("string");
    // A passed (esbuild-instrumented) function would carry __name; a string literal never does.
    expect(EXTRACT_API_CENTER_CENSUS).not.toContain("__name");
  });

  it("runs in a clean scope over a synthetic DOM and returns the census shape (no external helpers)", () => {
    // Running via `new Function` executes the script in a scope with NO esbuild helpers — if the script
    // referenced __name (or any module helper) this would throw ReferenceError, exactly reproducing the
    // live failure. A login-like fake DOM: one password + one text input, a submit control, one form.
    const doc = {
      querySelector: (sel: string) =>
        sel === "input[type='password']" || sel === "button[type='submit'], input[type='submit']" ? {} : null,
      querySelectorAll: (sel: string) => {
        if (sel === "input") return [
          { type: "password", readOnly: false, disabled: false },
          { type: "text", readOnly: false, disabled: false },
        ];
        if (sel === "form") return [{}];
        return []; // list-like containers
      },
    };
    const census = new Function("document", `return ${EXTRACT_API_CENTER_CENSUS}`)(doc) as ApiCenterStructuralCensus;
    expect(census).toEqual({
      passwordFieldPresent: true,
      submitAffordancePresent: true,
      formCount: 1,
      editableTextInputCount: 1, // the text input; the password input is not counted as editable
      readonlyFieldCount: 0,
      listLikeContainerCount: 0,
    });
    // And it classifies as a login page end-to-end.
    expect(observeFrom("api_center_host", census).pageCategory).toBe("login");
  });
});

describe("observeApiCenter — one-shot vs manual-login wait/re-observe (no login/click by the tool)", () => {
  const LOGIN = census({ passwordFieldPresent: true, submitAffordancePresent: true, formCount: 1, editableTextInputCount: 1 });
  const APP_LIST = census({ listLikeContainerCount: 3 });

  function scriptedDeps(sequence: ApiCenterStructuralCensus[]) {
    let i = 0;
    return {
      readCensus: vi.fn(async () => sequence[Math.min(i++, sequence.length - 1)]!),
      waitForManualLogin: vi.fn(async () => {}),
    };
  }

  it("one-shot (no wait flag): returns the first observation, never waits", async () => {
    const deps = scriptedDeps([LOGIN]);
    const r = await observeApiCenter("api_center_host", false, deps);
    expect(r.observation.pageCategory).toBe("login");
    expect(r.waited).toBe(false);
    expect(r.loginTransition).toBe("none");
    expect(deps.readCensus).toHaveBeenCalledTimes(1);
    expect(deps.waitForManualLogin).not.toHaveBeenCalled();
  });

  it("wait mode re-observes after the SELLER's manual login: login → app_list (tool authenticates nothing)", async () => {
    const deps = scriptedDeps([LOGIN, APP_LIST]);
    const r = await observeApiCenter("api_center_host", true, deps);
    expect(r.observation.pageCategory).toBe("app_list");
    expect(r.waited).toBe(true);
    expect(r.loginTransition).toBe("login_resolved"); // the page's login gate cleared, not a SellerOps auth
    expect(deps.readCensus).toHaveBeenCalledTimes(2);
    expect(deps.waitForManualLogin).toHaveBeenCalledTimes(1);
  });

  it("wait mode but the first read is NOT login → one-shot, no wait", async () => {
    const deps = scriptedDeps([APP_LIST]);
    const r = await observeApiCenter("api_center_host", true, deps);
    expect(r.observation.pageCategory).toBe("app_list");
    expect(r.waited).toBe(false);
    expect(deps.waitForManualLogin).not.toHaveBeenCalled();
  });

  it("wait mode but still login after re-observe → login_persists (does not fake progress)", async () => {
    const deps = scriptedDeps([LOGIN, LOGIN]);
    const r = await observeApiCenter("api_center_host", true, deps);
    expect(r.observation.pageCategory).toBe("login");
    expect(r.loginTransition).toBe("login_persists");
    expect(r.waited).toBe(true);
  });

  it("the result carries only sanitized enums/buckets/booleans — no raw values", async () => {
    const deps = scriptedDeps([LOGIN, census({ readonlyFieldCount: 7 })]);
    const r = await observeApiCenter("api_center_host", true, deps);
    const flat = JSON.stringify(r);
    expect(flat).not.toContain("7"); // the raw readonly count is bucketed, never emitted
    expect(r.observation.signals.readonlyFieldCountBucket).toBe("many");
  });
});

describe("observeApiCenterManualNavigation — manual-navigation checkpoint (no navigate/click by the tool)", () => {
  const APP_LIST = census({ listLikeContainerCount: 3 });
  const APP_DETAIL = census({ editableTextInputCount: 3, formCount: 1 });
  const CREDENTIAL = census({ readonlyFieldCount: 2 });
  const UNKNOWN = census({});

  function navDeps(first: ApiCenterStructuralCensus, second: ApiCenterStructuralCensus) {
    return {
      readCensus: vi.fn(async () => first),
      reReadCurrentCensus: vi.fn(async () => second),
      waitForManualNavigation: vi.fn(async () => {}),
    };
  }

  it("case 1: app_list → app_detail after the SELLER's manual navigation (re-reads current, never re-navigates)", async () => {
    const deps = navDeps(APP_LIST, APP_DETAIL);
    const r = await observeApiCenterManualNavigation("api_center_host", true, deps);
    expect(r.fromPageCategory).toBe("app_list");
    expect(r.observation.pageCategory).toBe("app_detail");
    expect(r.waited).toBe(true);
    expect(r.navigationTransition).toBe("category_changed");
    // The initial read navigates once; the re-observe uses the CURRENT-page reader — the tool never navigates.
    expect(deps.readCensus).toHaveBeenCalledTimes(1);
    expect(deps.reReadCurrentCensus).toHaveBeenCalledTimes(1);
    expect(deps.waitForManualNavigation).toHaveBeenCalledTimes(1);
  });

  it("case 2: app_detail → credential_issuance after manual navigation", async () => {
    const deps = navDeps(APP_DETAIL, CREDENTIAL);
    const r = await observeApiCenterManualNavigation("api_center_host", true, deps);
    expect(r.fromPageCategory).toBe("app_detail");
    expect(r.observation.pageCategory).toBe("credential_issuance");
    expect(r.navigationTransition).toBe("category_changed");
  });

  it("case 3: no transition (same category) → category_unchanged (does not fake progress)", async () => {
    const deps = navDeps(APP_LIST, APP_LIST);
    const r = await observeApiCenterManualNavigation("api_center_host", true, deps);
    expect(r.observation.pageCategory).toBe("app_list");
    expect(r.navigationTransition).toBe("category_unchanged");
  });

  it("case 4: ambiguous re-read stays fail-closed to unknown (still emits)", async () => {
    const deps = navDeps(APP_LIST, UNKNOWN);
    const r = await observeApiCenterManualNavigation("api_center_host", true, deps);
    expect(r.observation.pageCategory).toBe("unknown");
    expect(r.observation.blockers).toContain("AMBIGUOUS_SIGNALS");
    expect(r.navigationTransition).toBe("category_changed"); // app_list → unknown is still a category change
  });

  it("flag absent → one-shot: returns the entry observation, never waits or re-reads", async () => {
    const deps = navDeps(APP_LIST, APP_DETAIL);
    const r = await observeApiCenterManualNavigation("api_center_host", false, deps);
    expect(r.observation.pageCategory).toBe("app_list");
    expect(r.waited).toBe(false);
    expect(r.navigationTransition).toBe("none");
    expect(deps.reReadCurrentCensus).not.toHaveBeenCalled();
    expect(deps.waitForManualNavigation).not.toHaveBeenCalled();
  });

  it("emits only sanitized enums/buckets/booleans — no raw counts/values", async () => {
    const deps = navDeps(APP_LIST, census({ readonlyFieldCount: 7 }));
    const r = await observeApiCenterManualNavigation("api_center_host", true, deps);
    const flat = JSON.stringify(r);
    expect(flat).not.toContain("7"); // the raw readonly count is bucketed, never emitted
    expect(r.observation.signals.readonlyFieldCountBucket).toBe("many");
  });
});

describe("observeSentinelPathFor", () => {
  it("resolves the sentinel next to the status file", () => {
    expect(observeSentinelPathFor("/x/.status/naver.json")).toBe("/x/.status/observe-api-center.ready");
  });
});

describe("observeFrom — end-to-end sanitized shape leaks no value/URL/DOM", () => {
  it("emits only enums/buckets/booleans — no raw counts, no value fields", () => {
    const obs = observeFrom("api_center_host", census({ readonlyFieldCount: 9, editableTextInputCount: 0 }));
    expect(obs).toEqual({
      urlCategory: "api_center_host",
      pageCategory: "credential_issuance",
      signals: {
        urlCategory: "api_center_host",
        passwordFieldPresent: false,
        submitAffordancePresent: false,
        formCountBucket: "none",
        editableTextInputCountBucket: "none",
        readonlyFieldCountBucket: "many",
        listLikeContainerCountBucket: "none",
      },
      blockers: ["LIVE_DOM_CALIBRATION_PENDING"],
    });
    // Structural buckets only — the raw count (9) never surfaces anywhere in the output.
    expect(JSON.stringify(obs)).not.toContain("9");
  });
});
