import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recencyBucketFor } from "../../src/events/recency-bucket";

// Fixed synthetic reference time (epoch ms). No wall clock anywhere.
const REF = 1_000_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("recencyBucketFor — invalid / missing / future", () => {
  it("null / undefined eventTimeMs → unknown", () => {
    expect(recencyBucketFor(null, REF)).toBe("unknown");
    expect(recencyBucketFor(undefined, REF)).toBe("unknown");
  });

  it("non-finite eventTimeMs → unknown", () => {
    expect(recencyBucketFor(Number.NaN, REF)).toBe("unknown");
    expect(recencyBucketFor(Number.POSITIVE_INFINITY, REF)).toBe("unknown");
    expect(recencyBucketFor(Number.NEGATIVE_INFINITY, REF)).toBe("unknown");
  });

  it("non-finite referenceTimeMs → unknown", () => {
    expect(recencyBucketFor(REF - DAY, Number.NaN)).toBe("unknown");
    expect(recencyBucketFor(REF - DAY, Number.POSITIVE_INFINITY)).toBe("unknown");
  });

  it("future event (eventTimeMs > referenceTimeMs) → unknown", () => {
    expect(recencyBucketFor(REF + 1, REF)).toBe("unknown");
    expect(recencyBucketFor(REF + DAY, REF)).toBe("unknown");
  });
});

describe("recencyBucketFor — bucket boundaries", () => {
  const bucket = (ageMs: number) => recencyBucketFor(REF - ageMs, REF);

  it("age 0 → fresh_0_2h", () => {
    expect(bucket(0)).toBe("fresh_0_2h");
  });

  it("just under 2h → fresh_0_2h; exactly 2h → same_day_2_24h", () => {
    expect(bucket(2 * HOUR - 1)).toBe("fresh_0_2h");
    expect(bucket(2 * HOUR)).toBe("same_day_2_24h");
  });

  it("just under 24h → same_day_2_24h; exactly 24h → recent_1_3d", () => {
    expect(bucket(24 * HOUR - 1)).toBe("same_day_2_24h");
    expect(bucket(24 * HOUR)).toBe("recent_1_3d");
  });

  it("just under 3d → recent_1_3d; exactly 3d → aging_3_7d", () => {
    expect(bucket(3 * DAY - 1)).toBe("recent_1_3d");
    expect(bucket(3 * DAY)).toBe("aging_3_7d");
  });

  it("just under 7d → aging_3_7d; exactly 7d → stale_over_7d", () => {
    expect(bucket(7 * DAY - 1)).toBe("aging_3_7d");
    expect(bucket(7 * DAY)).toBe("stale_over_7d");
  });

  it("older than 7d → stale_over_7d", () => {
    expect(bucket(30 * DAY)).toBe("stale_over_7d");
  });
});

describe("recencyBucketFor — determinism", () => {
  it("repeated calls on the same inputs return identical results", () => {
    const e = REF - 5 * HOUR;
    expect(recencyBucketFor(e, REF)).toBe(recencyBucketFor(e, REF));
    expect(recencyBucketFor(e, REF)).toBe("same_day_2_24h");
  });

  it("output is only a coarse bucket string (never a duration/timestamp)", () => {
    const out = recencyBucketFor(REF - 5 * HOUR, REF);
    expect(typeof out).toBe("string");
    expect(["fresh_0_2h", "same_day_2_24h", "recent_1_3d", "aging_3_7d", "stale_over_7d", "unknown"]).toContain(out);
  });
});

describe("module boundary", () => {
  it("imports nothing, reads no current time, no network/fs/browser/env/AI", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "events", "recency-bucket.ts"),
      "utf8",
    );
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
      .join("\n");
    expect(imports.trim()).toBe(""); // pure module, no imports
    // no current-time / wall-clock usage in CODE (comments may discuss it).
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*/"));
      })
      .join("\n");
    expect(/Date\.now|new Date\(/.test(code)).toBe(false);
    expect(/generatedAt/.test(code)).toBe(false);
    expect(/process\.env|\bfetch\(|\baxios\b|playwright|openai|anthropic/i.test(code)).toBe(false);
  });
});
