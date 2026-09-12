/**
 * **Which executor carries a Coupang WING read, and what the seated path is guaranteed NOT to notice.**
 *
 * The production default is `LOCAL_HELPER` and this is where that stays true: the carrier assembled with no
 * environment at all must be the one that was live-proven on 2026-08-15, holding the seated driver and no
 * walk bound of its own. Selecting `ASIDE` is explicit, and selecting something this build cannot carry is
 * refused loudly rather than downgraded — a silent fallback to the seated path would be a run the operator
 * believes is deterministic and is not.
 */
import { describe, expect, it } from "vitest";
import { buildCoupangReviewAcquisitionLiveConfig } from "../../src/cli/local-agent";
import { AsideReviewAcquisitionDriver } from "../../src/aside/aside-review-acquisition-driver";
import { LazyReviewAcquisitionDriver } from "../../src/action-window/coupang-review/lazy-review-acquisition-driver";
import { EXECUTION_PROVIDER_ENV, assertExecutionProviderBootable } from "../../src/action-window/initial-import/execution-provider-selection";

/** `buildCoupangReviewAcquisitionLiveConfig` reads `process.env` through `loadConfig`. */
function withProvider<T>(value: string | undefined, fn: () => T): T {
  const had = Object.prototype.hasOwnProperty.call(process.env, EXECUTION_PROVIDER_ENV);
  const before = process.env[EXECUTION_PROVIDER_ENV];
  if (value === undefined) delete process.env[EXECUTION_PROVIDER_ENV];
  else process.env[EXECUTION_PROVIDER_ENV] = value;
  try {
    return fn();
  } finally {
    if (!had) delete process.env[EXECUTION_PROVIDER_ENV];
    else process.env[EXECUTION_PROVIDER_ENV] = before;
  }
}

describe("coupang acquisition — execution provider selection", () => {
  it("no environment ⇒ the seated carrier, with no bound of its own (the seller is the bound)", () => {
    const carrier = withProvider(undefined, buildCoupangReviewAcquisitionLiveConfig);
    expect(carrier.executionProvider).toBe("LOCAL_HELPER");
    expect(carrier.createDriver()).toBeInstanceOf(LazyReviewAcquisitionDriver);
    expect(carrier.maxPages).toBeUndefined();
    expect(carrier.channelCode).toBe("coupang");
  });

  it("an explicit ASIDE ⇒ the deterministic driver, pinned to ONE page", () => {
    const carrier = withProvider("ASIDE", buildCoupangReviewAcquisitionLiveConfig);
    expect(carrier.executionProvider).toBe("ASIDE");
    expect(carrier.createDriver()).toBeInstanceOf(AsideReviewAcquisitionDriver);
    // The whole safety claim of the first live run: one page ⇒ the walk stops before any pager exists to press.
    expect(carrier.maxPages).toBe(1);
  });

  it("the deterministic driver cannot turn a page — the seam has no verb for it", () => {
    const driver = withProvider("ASIDE", buildCoupangReviewAcquisitionLiveConfig).createDriver();
    for (const verb of ["nextPage", "turnPage", "click", "goto", "navigate", "paginate"]) {
      expect(verb in (driver as unknown as Record<string, unknown>)).toBe(false);
    }
  });

  it("an unknown provider is a configuration error, never a downgrade", () => {
    expect(() => withProvider("PLAYWRIGHT", buildCoupangReviewAcquisitionLiveConfig)).toThrow(/unknown execution provider/);
  });

  it("a provider with no workflow bound for that channel refuses to boot", () => {
    // Coupang HAS one since M3-C; NAVER's list is still empty, and its own carrier still refuses.
    expect(() => assertExecutionProviderBootable("ASIDE", ["coupang-wing-review-read"])).not.toThrow();
    expect(() => assertExecutionProviderBootable("ASIDE", [])).toThrow(/Refusing to start rather than falling back/);
  });
});
