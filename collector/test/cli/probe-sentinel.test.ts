import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import { SENTINEL_FILENAME, sentinelPathFor } from "../../src/cli/probe-sentinel";

describe("sentinelPathFor", () => {
  it("places the sentinel in the status file's directory with the fixed filename", () => {
    expect(sentinelPathFor("/srv/collector/.status/naver.json")).toBe(
      "/srv/collector/.status/probe-same-session.ready",
    );
  });

  it("uses the fixed SENTINEL_FILENAME", () => {
    expect(SENTINEL_FILENAME).toBe("probe-same-session.ready");
    expect(sentinelPathFor("/a/b/.status/naver.json").endsWith(`/${SENTINEL_FILENAME}`)).toBe(true);
  });

  it("honours a relocated (overridden) status file path", () => {
    expect(sentinelPathFor("/var/run/collector/state/run.json")).toBe(
      "/var/run/collector/state/probe-same-session.ready",
    );
  });

  it("returns an absolute path", () => {
    expect(isAbsolute(sentinelPathFor("/x/y/.status/naver.json"))).toBe(true);
    // Even a relative input resolves to an absolute path (relative to cwd).
    expect(isAbsolute(sentinelPathFor(".status/naver.json"))).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const s = "/srv/.status/naver.json";
    expect(sentinelPathFor(s)).toBe(sentinelPathFor(s));
  });

  it("does not depend on the status filename, only its directory", () => {
    expect(sentinelPathFor("/srv/.status/naver.json")).toBe(
      sentinelPathFor("/srv/.status/anything-else.json"),
    );
  });
});
