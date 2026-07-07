import { describe, it, expect } from "vitest";
import { dirname } from "node:path";
import { humanSignalPathFor } from "../../src/agent/local-agent-human-signal";

const STATUS = "/var/tmp/x/.status/naver.json";

describe("local-agent human-completed sentinel path", () => {
  it("is connection-specific: A and B never collide", () => {
    expect(humanSignalPathFor(STATUS, "conn-A")).not.toBe(humanSignalPathFor(STATUS, "conn-B"));
  });

  it("is deterministic: the same id yields the same path", () => {
    expect(humanSignalPathFor(STATUS, "conn-A")).toBe(humanSignalPathFor(STATUS, "conn-A"));
  });

  it("lives in the same status dir as the status file", () => {
    expect(dirname(humanSignalPathFor(STATUS, "conn-A"))).toBe(dirname(STATUS));
  });

  it("is path-safe for hostile ids, embeds only a hash, and never escapes the status dir", () => {
    for (const id of ["../../../etc/passwd", "a/b\\c/..\\d", "판매자-🔥@example.com", "conn with spaces"]) {
      const p = humanSignalPathFor(STATUS, id);
      const filename = p.slice(dirname(STATUS).length + 1);
      expect(filename).toMatch(/^local-agent-human-completed\.[0-9a-f]{24}\.signal$/); // hashed, no separators
      expect(p).not.toContain(id); // the raw connection id never appears in the path
      expect(dirname(p)).toBe(dirname(STATUS)); // never traverses out of .status
    }
  });
});
