/**
 * **The 고객문의 calibration CLI's gate, and the one input that reaches into the page.**
 *
 * `parseTargetIds` is a boundary, not a convenience: what it returns is embedded in a script the WING page
 * executes. So it accepts digits and nothing else, and a malformed pair is dropped rather than repaired — a
 * calibration that silently searched for something other than what the operator named would produce a count
 * nobody could interpret.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALIBRATION_BANNER_LINES,
  INQUIRY_LIST_CALIBRATION_OPERATION,
  calibrationAsk,
  calibrationExitCode,
  parseTargetIds,
} from "../../src/cli/calibrate-inquiry-list";
import { PHASE_SPECS } from "../../src/cli/approval-manifest";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the identifiers that reach into the page", () => {
  it("accepts well-formed id:digits pairs and preserves the operator's order", () => {
    expect(parseTargetIds("inquiryId:158421449,productId:15411270785")).toEqual([
      { id: "inquiryId", digits: "158421449" },
      { id: "productId", digits: "15411270785" },
    ]);
  });

  it("**drops anything that is not digits** rather than repairing it", () => {
    for (const bad of [
      "inquiryId:15842 1449",
      "inquiryId:158421449'",
      "inquiryId:0x158421449",
      "inquiryId:</script>",
      "inquiryId:158-421-449",
      "inquiryId:",
      ":158421449",
      "in quiry:158421449",
      "inquiryId",
      "",
    ]) {
      expect(parseTargetIds(bad), `accepted ${bad}`).toEqual([]);
    }
    expect(parseTargetIds(undefined)).toEqual([]);
  });

  it("keeps the first of a duplicated id, so one name means one thing", () => {
    expect(parseTargetIds("inquiryId:1,inquiryId:2")).toEqual([{ id: "inquiryId", digits: "1" }]);
  });

  it("drops only the malformed pair, never the whole list", () => {
    expect(parseTargetIds("inquiryId:158421449,bogus:xyz,productId:15411270785")).toEqual([
      { id: "inquiryId", digits: "158421449" },
      { id: "productId", digits: "15411270785" },
    ]);
  });
});

describe("the run declares what it is", () => {
  it("is a READ_ONLY phase whose declared actions include no read, click, or highlight", () => {
    const spec = PHASE_SPECS.COUPANG_WING_INQUIRY_LIST_CALIBRATION;
    expect(spec.mode).toBe("READ_ONLY");
    expect(spec.allowsHighlight).toBe(false);
    expect(spec.capableActions).toEqual([
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "MEASURE_INQUIRY_LIST_STRUCTURE",
      "COUNT_INQUIRY_TARGET_MATCHES",
    ]);
    // The actions that read or write a marketplace must not be reachable from this phase's declaration.
    for (const forbidden of [
      "READ_CREDENTIAL_VALUES_ONCE",
      "HIGHLIGHT_REAL_CONTROL",
      "OBSERVE_USER_CLICK_TRANSITION",
      "HAND_CREDENTIAL_TO_SELLEROPS_BACKEND",
    ]) {
      expect(spec.capableActions).not.toContain(forbidden);
    }
  });

  it("**the disclosure is precise about text, not flattering**, and the checkpoint repeats it", () => {
    // An earlier version of this scope claimed "reads no buyer text". The probe DOES compare page text — to
    // fixed platform literals we supply, on leaf elements, reduced to a boolean inside the page. So the true
    // claim is that buyer text never LEAVES the page. An operator approving a screen full of customers'
    // questions is owed the accurate sentence, and an overstated one is the kind that quietly stops being true.
    for (const disclosure of [INQUIRY_LIST_CALIBRATION_OPERATION, CALIBRATION_BANNER_LINES.join(" ")]) {
      expect(disclosure.toLowerCase()).toContain("buyer text never leaves the page");
      expect(disclosure.toLowerCase()).not.toContain("reads no buyer text");
      expect(disclosure.toLowerCase()).not.toContain("0 buyer-text reads");
    }
    expect(calibrationAsk().lines.join(" ")).toContain("이 창 밖으로 나가지 않습니다");
  });

  it("**an unresolved target is its own exit code**, never rounded up to success", () => {
    expect(calibrationExitCode("MEASURED", true)).toBe(0);
    // 5 is the measurement "we cannot point at that inquiry" — a real result a caller must be able to see.
    expect(calibrationExitCode("MEASURED", false)).toBe(5);
    expect(calibrationExitCode("ABORTED_BEFORE_CHECKPOINT", false)).toBe(7);
    expect(calibrationExitCode("ABORTED_BEFORE_CHECKPOINT", true)).toBe(7);
  });

  it("has no click, type, or navigation path in its source", () => {
    const source = readFileSync(resolve(HERE, "../../src/cli/calibrate-inquiry-list.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"))
      .join("\n");
    for (const forbidden of [".click(", ".fill(", ".type(", ".press(", ".goto(", "waitForEvent"]) {
      expect(code, `calibration CLI must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
