import { describe, it, expect } from "vitest";
import { IN_PAGE_LOGIN_SIGNAL } from "../../../src/action-window/reply-submission/reply-row-composer-inpage";

function evaluateSignal(host: string, href: string, dataPage = ""): boolean {
  const location = { href, hostname: host };
  const document = { body: { getAttribute: () => dataPage } };
  // eslint-disable-next-line no-new-func
  return new Function("location", "document", `return ${IN_PAGE_LOGIN_SIGNAL}`)(location, document) as boolean;
}

/**
 * The signal decides whether a guided reply run believes it is looking at the seller's own pages.
 *
 * <b>Two live sittings failed on this exact string</b> (2026-09-03): NAVER sends an unauthenticated seller
 * to `https://nid.naver.com/nidlogin.login?mode=form&url=…`, which has no `/login` PATH segment — "nidlogin"
 * is one word — and carries no `data-page`. Both text tests passed, the run was told it was signed in, it
 * scanned the login screen for review rows, found none, and ended as TARGET_NOT_FOUND while the seller was
 * still typing their password.
 */
describe("login signal", () => {
  it("knows NAVER's auth hosts by name", () => {
    expect(evaluateSignal("nid.naver.com", "https://nid.naver.com/nidlogin.login?mode=form&url=x")).toBe(false);
    expect(evaluateSignal("accounts.commerce.naver.com", "https://accounts.commerce.naver.com/login?url=x")).toBe(false);
  });

  it("still reads the seller center as signed in", () => {
    expect(evaluateSignal("sell.smartstore.naver.com", "https://sell.smartstore.naver.com/#/review/search")).toBe(true);
  });

  it("keeps the older text tests — they were narrow, not wrong", () => {
    expect(evaluateSignal("sell.smartstore.naver.com", "https://sell.smartstore.naver.com/#/login")).toBe(false);
    expect(evaluateSignal("sell.smartstore.naver.com", "https://sell.smartstore.naver.com/#/review/search", "login")).toBe(false);
  });
});
