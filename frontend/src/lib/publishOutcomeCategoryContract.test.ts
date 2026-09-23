import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { publishCategoryLabel, canResumePublish, canVerifyPublish } from "./inquiryPublish";
import { draftSendWord, DRAFT_UNSENT } from "./copy/customerOps";

/**
 * <b>The two vocabularies for a publish outcome must be the same vocabulary.</b>
 *
 * The backend serialises {@code PublishOutcomeCategory} with {@code name()} — no {@code @JsonValue},
 * no enum-naming strategy — so the JSON the browser receives carries the Java constant names exactly.
 * `types.ts` declares a union that calls itself a mirror of that enum. For months it was not one: it
 * said `"RETRYABLE"` / `"PERMANENT"` and omitted `PENDING`, and **nothing in the repository noticed**.
 *
 * Why nothing noticed is the reason this file exists:
 *
 * <ul>
 *   <li>TypeScript cannot check a hand-written union against a Java enum.</li>
 *   <li>`publishCategoryLabel`'s `switch` had no `default`, so TS treated it as exhaustive over the
 *       wrong union and returned `undefined` at runtime — into a `<p>`.</li>
 *   <li>`COMPLETED` happens to be spelled identically on both sides, so the success path worked. The
 *       Stage 3 live proof (2026-09-23) produced only `COMPLETED` and passed.</li>
 *   <li>The one frontend delivery fixture used `category: "COMPLETED"` too.</li>
 * </ul>
 *
 * So the failure states — the ones a seller meets on their worst day — rendered as an empty bordered
 * box with no control, and the case screen tagged a dispatched-and-refused reply 「미발송」.
 *
 * This test reads the Java source. It is deliberately not a second hand-written list: a list here
 * would be a third copy of the thing that already drifted twice.
 */

const JAVA = resolve(
  __dirname,
  "../../../backend/src/main/java/com/sellerops/inquiry/publish/PublishOutcomeCategory.java",
);
const TYPES = resolve(__dirname, "./types.ts");

/** The enum's constant names, read out of the Java file. */
function javaConstants(): string[] {
  const src = readFileSync(JAVA, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "") // block and javadoc comments
    .replace(/\/\/[^\n]*/g, "");
  const open = src.indexOf("enum PublishOutcomeCategory");
  expect(open, "the enum declaration must be findable in the Java source").toBeGreaterThan(-1);
  const body = src.slice(src.indexOf("{", open) + 1);
  // The constant list ends at the first `;` — everything after it is methods.
  const list = body.slice(0, body.indexOf(";"));
  return list
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^[A-Z][A-Z0-9_]*$/.test(t));
}

/** The union members, read out of the TypeScript source rather than imported. */
function tsUnionMembers(): string[] {
  const src = readFileSync(TYPES, "utf8");
  const at = src.indexOf("export type PublishOutcomeCategory =");
  expect(at, "the union declaration must be findable in types.ts").toBeGreaterThan(-1);
  const decl = src.slice(at, src.indexOf(";", at));
  return [...decl.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

describe("PublishOutcomeCategory — backend enum is the source of truth", () => {
  it("the Java enum still has the six constants this build was written against", () => {
    // Not a redundant restatement of the test below: it is what makes a FAILURE here readable. If
    // the backend gains a seventh outcome, this line names it, rather than leaving an operator to
    // diff two generated sets.
    expect(javaConstants().sort()).toEqual(
      ["CHECKING_REQUIRED", "COMPLETED", "PENDING", "PERMANENT_FAILURE", "PUBLISHING", "RETRYABLE_FAILURE"].sort(),
    );
  });

  it("the TypeScript union is exactly the Java enum's constant names", () => {
    expect(tsUnionMembers().sort()).toEqual(javaConstants().sort());
  });

  it("every backend constant renders a seller sentence — none is silent", () => {
    for (const c of javaConstants()) {
      const sentence = publishCategoryLabel(c);
      expect(sentence, `${c} must render a sentence`).toBeTruthy();
      expect(typeof sentence).toBe("string");
      expect(sentence).not.toContain(c); // never the raw token
    }
  });

  it("every backend constant gets a send word that is not the raw token", () => {
    for (const c of javaConstants()) {
      const word = draftSendWord({ category: c });
      expect(word, `${c} must render a word`).toBeTruthy();
      expect(word).not.toContain(c);
    }
  });
});

describe("an unknown token never produces an empty screen", () => {
  // A newer backend, or a vocabulary that drifts again. The original defect was not that the wrong
  // names were chosen — it was that being wrong produced SILENCE rather than a failure.
  const UNKNOWN = "SOME_FUTURE_OUTCOME";

  it("renders a sentence rather than undefined", () => {
    const sentence = publishCategoryLabel(UNKNOWN);
    expect(sentence).toBeTruthy();
    expect(sentence).not.toContain(UNKNOWN);
  });

  it("claims neither success nor failure", () => {
    const sentence = publishCategoryLabel(UNKNOWN);
    expect(sentence).not.toContain("등록되었습니다");
    expect(sentence).not.toContain("등록할 수 없습니다");
  });

  it("offers the read-only check and never the resend", () => {
    // Re-querying cannot put a second message in front of a customer; resuming can.
    expect(canVerifyPublish({ category: UNKNOWN })).toBe(true);
    expect(canResumePublish({ category: UNKNOWN })).toBe(false);
  });

  it("is not tagged 「미발송」 — that word is only for a draft with no delivery row at all", () => {
    expect(draftSendWord({ category: UNKNOWN })).not.toBe(DRAFT_UNSENT);
    expect(draftSendWord(null)).toBe(DRAFT_UNSENT);
    expect(draftSendWord(undefined)).toBe(DRAFT_UNSENT);
  });
});

describe("RETRYABLE_FAILURE — the seller can still get there from here", () => {
  it("offers 「이어서 등록」", () => {
    expect(canResumePublish({ category: "RETRYABLE_FAILURE" })).toBe(true);
  });

  it("says a retry is possible", () => {
    expect(publishCategoryLabel("RETRYABLE_FAILURE")).toContain("다시 시도");
  });

  it("is not 「미발송」 and not 「등록 실패」 — nothing was sent, and it is not over", () => {
    const word = draftSendWord({ category: "RETRYABLE_FAILURE" });
    expect(word).not.toBe(DRAFT_UNSENT);
    expect(word).not.toBe("등록 실패");
    expect(word).toBe("등록 대기");
  });
});

describe("PENDING — bound, and nothing has left", () => {
  it("offers a way to continue", () => {
    expect(canResumePublish({ category: "PENDING" })).toBe(true);
  });

  it("does not claim the answer was registered", () => {
    expect(publishCategoryLabel("PENDING")).not.toContain("등록되었습니다");
  });
});

describe("PERMANENT_FAILURE — never described as unsent, never offered a resend", () => {
  it("is tagged 「등록 실패」, not 「미발송」", () => {
    // It WAS dispatched, and the channel refused it. 「미발송」 is a false sentence about it, and it
    // is the sentence this screen printed before the vocabulary was fixed.
    expect(draftSendWord({ category: "PERMANENT_FAILURE" })).toBe("등록 실패");
    expect(draftSendWord({ category: "PERMANENT_FAILURE" })).not.toBe(DRAFT_UNSENT);
  });

  it("tells the seller to answer in the seller centre", () => {
    expect(publishCategoryLabel("PERMANENT_FAILURE")).toContain("판매자센터");
  });

  it("offers no resend", () => {
    expect(canResumePublish({ category: "PERMANENT_FAILURE" })).toBe(false);
  });
});

describe("the states that must not change", () => {
  it("COMPLETED is terminal — no controls", () => {
    expect(canResumePublish({ category: "COMPLETED" })).toBe(false);
    expect(canVerifyPublish({ category: "COMPLETED" })).toBe(false);
    expect(draftSendWord({ category: "COMPLETED" })).toBe("등록됨");
  });

  it("CHECKING_REQUIRED verifies and never resends", () => {
    // DELIVERY_UNKNOWN lands here: the request left and nobody observed the answer. Offering a
    // resend is how a duplicate reply reaches a customer.
    expect(canVerifyPublish({ category: "CHECKING_REQUIRED" })).toBe(true);
    expect(canResumePublish({ category: "CHECKING_REQUIRED" })).toBe(false);
    expect(publishCategoryLabel("CHECKING_REQUIRED")).not.toContain("실패");
  });

  it("a null status offers nothing", () => {
    expect(canResumePublish(null)).toBe(false);
    expect(canVerifyPublish(null)).toBe(false);
  });
});
