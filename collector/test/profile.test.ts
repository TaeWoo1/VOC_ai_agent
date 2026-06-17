import { describe, expect, it } from "vitest";
import { resolveProfileDir } from "../src/profile";

const ROOT = "/tmp/collector-root";

describe("resolveProfileDir", () => {
  it("accepts the collector root itself", () => {
    expect(resolveProfileDir(ROOT, ROOT)).toBe(ROOT);
  });

  it("accepts a path nested under the collector root", () => {
    expect(resolveProfileDir(`${ROOT}/.profile/naver`, ROOT)).toBe(`${ROOT}/.profile/naver`);
  });

  it("rejects an absolute path outside the collector root", () => {
    expect(() => resolveProfileDir("/etc/passwd", ROOT)).toThrow(/inside the collector/);
  });

  it("rejects a traversal that escapes the collector root", () => {
    expect(() => resolveProfileDir(`${ROOT}/../evil`, ROOT)).toThrow(/inside the collector/);
  });

  it("rejects a sibling whose name only prefixes the root", () => {
    // `${ROOT}-evil` shares the string prefix but is NOT under `${ROOT}/`.
    expect(() => resolveProfileDir(`${ROOT}-evil/profile`, ROOT)).toThrow(/inside the collector/);
  });
});
