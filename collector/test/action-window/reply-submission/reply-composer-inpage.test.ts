/**
 * The composer-abort in-page helpers. The read-only draft overlay must embed the seller's own approved draft
 * SAFELY (a JSON string literal that cannot break out of the evaluate expression), render it via textContent
 * (never an input value), and stay non-interactive (pointer-events:none). The capture/census/teardown scripts
 * must never carry a submit/type/click token.
 */
import { describe, it, expect } from "vitest";
import {
  ARM_COMPOSER_CAPTURE,
  COMPOSER_CENSUS,
  COMPOSER_PICKED,
  COMPOSER_TEARDOWN,
  renderDraftOverlay,
} from "../../../src/action-window/reply-submission/reply-composer-inpage";

const NO_SUBMIT_TOKENS = [
  ".click(",
  ".type(",
  ".fill(",
  ".press(",
  ".check(",
  ".selectOption(",
  ".setInputFiles(",
  ".keyboard",
  "dispatchEvent",
  ".submit(",
  ".value =",
  ".value=",
] as const;

describe("renderDraftOverlay — read-only, safely embedded", () => {
  it("embeds the draft as a JSON string literal and renders it via textContent (never a value)", () => {
    const draft = "안녕하세요, 환불 도와드리겠습니다.";
    const s = renderDraftOverlay(draft);
    expect(s).toContain(JSON.stringify(draft));
    expect(s).toContain("textContent");
    expect(s).not.toContain(".value");
  });

  it("is non-interactive (pointer-events:none) and labelled read-only SellerOps", () => {
    const s = renderDraftOverlay("draft");
    expect(s).toContain("pointer-events:none");
    expect(s).toContain("읽기 전용");
    expect(s).toContain("SellerOps");
  });

  it("neutralises a hostile draft that tries to break out of the expression", () => {
    const hostile = `"; window.__pwned = 1; document.body.innerHTML = "x`;
    const s = renderDraftOverlay(hostile);
    // The payload appears ONLY inside the escaped JSON string literal assigned to textContent — its leading
    // quote is escaped (\"), so it cannot terminate the assignment and inject live code.
    expect(s).toContain(`body.textContent = ${JSON.stringify(hostile)};`);
    expect(s).toContain('\\";'); // the breakout quote was escaped
    expect(s).not.toContain('body.textContent = "";'); // it never becomes an empty string + injected statement
  });

  it("the overlay + capture + census + teardown scripts carry no submit/type/click token", () => {
    const scripts = [
      renderDraftOverlay("hi"),
      ARM_COMPOSER_CAPTURE,
      COMPOSER_CENSUS,
      COMPOSER_PICKED,
      COMPOSER_TEARDOWN,
    ];
    for (const s of scripts) {
      for (const token of NO_SUBMIT_TOKENS) expect(s, `token ${token}`).not.toContain(token);
    }
  });

  it("the capture script intercepts (preventDefault) and only marks — it never activates the click", () => {
    expect(ARM_COMPOSER_CAPTURE).toContain("preventDefault");
    expect(ARM_COMPOSER_CAPTURE).toContain("stopImmediatePropagation");
    expect(ARM_COMPOSER_CAPTURE).toContain("data-aw-composer-anchor");
  });
});
