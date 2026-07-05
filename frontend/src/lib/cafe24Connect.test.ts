import { describe, expect, it } from "vitest";
import { classifyStartError, normalizeMallId, parseCafe24Result } from "./cafe24Connect";

describe("normalizeMallId", () => {
  it("accepts and lowercases/trims a valid mall id", () => {
    expect(normalizeMallId("MyStore")).toBe("mystore");
    expect(normalizeMallId("  mystore  ")).toBe("mystore");
    expect(normalizeMallId("my-store-1")).toBe("my-store-1");
    expect(normalizeMallId("a")).toBe("a");
    expect(normalizeMallId("a".repeat(63))).toBe("a".repeat(63));
  });

  it("rejects malformed ids conservatively", () => {
    for (const bad of [
      "",
      "   ",
      "bad_mall",
      "-mall",
      "mall-",
      "a b",
      "mall.cafe24",
      "mall!",
      "'; DROP TABLE",
      "가게",
      "a".repeat(64),
    ]) {
      expect(normalizeMallId(bad)).toBeNull();
    }
    expect(normalizeMallId(null)).toBeNull();
    expect(normalizeMallId(undefined)).toBeNull();
  });
});

describe("parseCafe24Result", () => {
  const parse = (query: string) => parseCafe24Result(new URLSearchParams(query));

  it("reads each known status", () => {
    expect(parse("status=connected").status).toBe("connected");
    expect(parse("status=reconnect_required").status).toBe("reconnect_required");
    expect(parse("status=invalid").status).toBe("invalid");
  });

  it("maps missing or malformed status to unknown", () => {
    expect(parse("").status).toBe("unknown");
    expect(parse("status=").status).toBe("unknown");
    expect(parse("status=success").status).toBe("unknown");
    expect(parse("status=CONNECTED").status).toBe("unknown"); // exact-match contract
  });

  it("reads the optional accountId", () => {
    expect(parse("status=connected&accountId=acc-123").accountId).toBe("acc-123");
    expect(parse("status=connected").accountId).toBeNull();
    expect(parse("status=connected&accountId=").accountId).toBeNull();
  });

  it("never surfaces code/state/token query values", () => {
    const result = parse(
      "status=connected&code=SECRETCODE&state=RAWSTATE&access_token=ATOKEN&refresh_token=RTOKEN",
    );
    expect(Object.keys(result).sort()).toEqual(["accountId", "status"]);
    const serialized = JSON.stringify(result);
    for (const secret of ["SECRETCODE", "RAWSTATE", "ATOKEN", "RTOKEN"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("classifyStartError", () => {
  const err = (status?: number, message?: string) => ({
    response: status === undefined ? undefined : { status, data: message ? { message } : undefined },
  });

  it("classifies by HTTP status", () => {
    expect(classifyStartError(err(400, "몰 ID 형식이 올바르지 않습니다."))).toBe(
      "몰 ID 형식이 올바르지 않습니다.",
    );
    expect(classifyStartError(err(400))).toContain("몰 ID");
    expect(classifyStartError(err(401))).toContain("로그인");
    expect(classifyStartError(err(404))).toContain("사용할 수 없습니다");
  });

  it("falls back for network / unknown failures", () => {
    expect(classifyStartError(err(undefined))).toContain("백엔드");
    expect(classifyStartError(new Error("Network Error"))).toContain("백엔드");
    expect(classifyStartError(undefined)).toContain("백엔드");
  });
});
