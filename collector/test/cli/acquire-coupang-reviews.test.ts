/**
 * **The acquisition entrypoint, and what it tells the operator it will do.**
 *
 * This run is the first Coupang 상품평 path that takes review text off the screen and stores it, so the tests
 * that matter are the ones holding the DESCRIPTION to the behaviour. This workstream has already shipped a
 * bootstrap banner describing a measurement that no longer existed, and a preflight PASS line naming a reading
 * that had been removed two units earlier — both found by running the scripts and reading the output, not by a
 * test. Every promise here is asserted against the shipping code instead.
 *
 * The shell files are read as files, deliberately: every TypeScript surface in this workstream was already
 * pinned by a test when those two defects shipped, and the shell was not.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACQUISITION_BANNER_LINES,
  ACQUISITION_OPERATION,
  acquisitionAsk,
  acquisitionExitCode,
  acquisitionRunGrantBinding,
  parseAccountSlot,
  summarize,
} from "../../src/cli/acquire-coupang-reviews";
import {
  COUPANG_WING_REVIEW_ACQUISITION_SCOPE,
  PHASE_SPECS,
  PINNED_PHASE_SCOPES,
} from "../../src/cli/approval-manifest";
import type { AcquisitionResult } from "../../src/action-window/coupang-review/review-acquisition";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CLI_SOURCE = readFileSync(resolve(REPO_ROOT, "collector/src/cli/acquire-coupang-reviews.ts"), "utf8");
const BOOTSTRAP = readFileSync(resolve(REPO_ROOT, "tools/coupang-local/wing-review-acquire-bootstrap.sh"), "utf8");
const PREFLIGHT = readFileSync(resolve(REPO_ROOT, "tools/coupang-local/wing-review-acquire-preflight.sh"), "utf8");

function result(over: Partial<AcquisitionResult> = {}): AcquisitionResult {
  return {
    complete: true,
    operatorFinished: false,
    stopReason: "FINAL_PAGE_REACHED",
    pagesAccepted: 2,
    rowsRead: 20,
    lastPageNumber: 2,
    reviews: [],
    dropped: { unparseableDate: 0, unreadableRating: 0, noProductId: 0, noBody: 0 },
    repeatedPages: 0,
    ...over,
  };
}

describe("the phase this CLI runs under is its own, and says what it takes", () => {
  it("names this file as its entrypoint, so the gate's CLI check binds to the run that exists", () => {
    expect(PHASE_SPECS.COUPANG_WING_REVIEW_ACQUISITION.cli).toBe("src/cli/acquire-coupang-reviews.ts");
  });

  it("declares the three actions that make it different from the discovery next door", () => {
    const actions = PHASE_SPECS.COUPANG_WING_REVIEW_ACQUISITION.capableActions;
    expect(actions).toContain("READ_REVIEW_ROWS");
    expect(actions).toContain("HAND_REVIEWS_TO_SELLEROPS_BACKEND");
    expect(actions).toContain("HIGHLIGHT_ONE_REVIEW_ROW");
    // The discovery measures; it may not read a row, hand anything over, or ring anything.
    const discovery = PHASE_SPECS.COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY;
    expect(discovery.capableActions).not.toContain("READ_REVIEW_ROWS");
    expect(discovery.allowsHighlight).toBe(false);
  });

  it("rings a content-matched ROW, which is why it is not gated on a calibrated selector", () => {
    expect(PHASE_SPECS.COUPANG_WING_REVIEW_ACQUISITION.allowsHighlight).toBe(true);
    expect(PHASE_SPECS.COUPANG_WING_REVIEW_ACQUISITION.highlightTarget).toBe("CONTENT_MATCHED_ROW");
  });

  it("admits in the scope sentence that it collects and stores, rather than that it reads a list", () => {
    const scope = COUPANG_WING_REVIEW_ACQUISITION_SCOPE.operation;
    expect(scope).toContain("COLLECTS");
    expect(scope).toContain("review body");
    // And it says the two things that bound it.
    expect(scope).toContain("구매자/작성자");
    expect(scope).toContain("NEVER presses");
  });

  it("states zero marketplace actions and zero page turns in the budget", () => {
    const max = COUPANG_WING_REVIEW_ACQUISITION_SCOPE.maxActions;
    expect(max).toContain("0 marketplace actions");
    expect(max).toContain("0 page turns");
    expect(max).toContain("0 buyer/작성자 names read");
  });

  it("is pinned so it cannot inherit the manifest CLI's generic issuance wording", () => {
    expect(PINNED_PHASE_SCOPES.COUPANG_WING_REVIEW_ACQUISITION?.surface).toBe("Coupang WING 상품평");
    expect(PINNED_PHASE_SCOPES.COUPANG_WING_REVIEW_ACQUISITION?.operation).toBe(ACQUISITION_OPERATION);
  });
});

describe("the account slot is required before a browser opens", () => {
  it("accepts exactly 24 lowercase hex", () => {
    expect(parseAccountSlot("0123456789abcdef01234567")).toBe("0123456789abcdef01234567");
  });

  it("refuses everything else rather than repairing it", () => {
    for (const bad of [undefined, "", "0123456789ABCDEF01234567", "0123456789abcdef0123456", "not-hex-at-all"]) {
      expect(parseAccountSlot(bad)).toBeNull();
    }
  });
});

describe("the exit code says what actually happened", () => {
  it("0 only when the walk covered the list AND the handoff stored it", () => {
    expect(acquisitionExitCode("COLLECTED", true, true)).toBe(0);
  });

  it("5 when reviews were stored but the list was not covered — a real result, not a failure", () => {
    expect(acquisitionExitCode("COLLECTED", false, true)).toBe(5);
  });

  it("6 when the handoff was refused, however complete the walk was", () => {
    expect(acquisitionExitCode("COLLECTED", true, false)).toBe(6);
    expect(acquisitionExitCode("COLLECTED", false, false)).toBe(6);
  });

  it("7 when nothing was collected at all", () => {
    expect(acquisitionExitCode("ABORTED_BEFORE_CHECKPOINT", true, true)).toBe(7);
    expect(acquisitionExitCode("NOTHING_COLLECTED", true, true)).toBe(7);
  });
});

describe("what the run prints", () => {
  it("summarizes in counts and enums, and never in review text", () => {
    const line = summarize(result(), { ok: true, received: 4, stored: 3, skipped: 1, failed: 0, reason: null });

    expect(line).toContain("pages=2");
    expect(line).toContain("complete=true");
    expect(line).toContain("stop=FINAL_PAGE_REACHED");
    expect(line).toContain("stored=3");
    expect(line).toContain("skipped=1");
  });

  it("says the handoff was not attempted rather than implying a zero result", () => {
    expect(summarize(result(), null)).toContain("handoff=NOT_ATTEMPTED");
  });

  it("carries the drop counts, so a skipped review is reported rather than lost", () => {
    const line = summarize(result({ dropped: { unparseableDate: 1, unreadableRating: 0, noProductId: 0, noBody: 3 } }), null);

    expect(line).toContain("date=1");
    expect(line).toContain("body=3");
  });

  it("banners the collection, the buyer exclusion, and who turns the pages", () => {
    const banner = ACQUISITION_BANNER_LINES.join(" ");

    expect(banner).toContain("STORES them in SellerOps");
    expect(banner).toContain("resolved ONLY so");
    expect(banner).toContain("THE OPERATOR TURNS EVERY PAGE");
    expect(banner).toContain("never by inference");
  });
});

describe("the per-page checkpoint asks for the page in front of the operator", () => {
  it("counts the sitting's pages rather than claiming to know the screen's own page number", () => {
    expect(acquisitionAsk(3).title).toContain("3번째");
  });

  it("says what the press stores, and that the buyer is not part of it", () => {
    const lines = acquisitionAsk(1).lines.join(" ");

    expect(lines).toContain("SellerOps에 저장합니다");
    expect(lines).toContain("구매자 이름은 읽지 않습니다");
    expect(lines).toContain("중복 저장되지 않습니다");
  });

  it("tells the operator that paging is theirs", () => {
    expect(acquisitionAsk(1).lines.join(" ")).toContain("직접 페이지를 넘긴 뒤");
  });

  it("offers the second answer that ends the walk, so stopping needs no abort file", () => {
    expect(acquisitionAsk(1).secondary?.label).toContain("끝내기");
  });

  it("never promises that SellerOps turns a page", () => {
    const all = [...acquisitionAsk(1).lines, acquisitionRunGrantBinding().agentDoesNot].join(" ");

    expect(all).toContain("SellerOps는 넘기지 않습니다");
  });
});

describe("the CLI cannot act on the marketplace", () => {
  it("contains no click, type, submit, or navigation call", () => {
    const code = CLI_SOURCE.split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");

    for (const forbidden of [".click(", ".fill(", ".type(", ".press(", ".selectOption(", ".goto(", ".setInputFiles("]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("is inert on import — nothing launches unless it is the invoked entrypoint", () => {
    expect(CLI_SOURCE).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });

  it("screens the backend origin before the browser and before the login", () => {
    const backendAt = CLI_SOURCE.indexOf("screenCredentialBackendOrigin");
    const launchAt = CLI_SOURCE.indexOf("launchNaverContext(");
    expect(backendAt).toBeGreaterThan(0);
    expect(backendAt).toBeLessThan(launchAt);
  });
});

describe("the harness scripts describe the run that exists", () => {
  it("bootstraps its OWN run env, so a discovery grant cannot be spent here", () => {
    expect(BOOTSTRAP).toContain("COUPANG_WING_REVIEW_ACQUISITION");
    expect(BOOTSTRAP).toContain("wing-review-acquisition.env");
    // The counting run's env file is a different one; sharing it is what would let one grant serve both.
    expect(BOOTSTRAP).not.toContain("wing-review-discovery.env");
  });

  it("says in the bootstrap banner that this run stores reviews", () => {
    expect(BOOTSTRAP).toContain("STORES them in SellerOps");
    expect(BOOTSTRAP).toContain("NOT COLLECTED");
    expect(BOOTSTRAP).toContain("SellerOps never turns a page");
  });

  it("requires the account slot in the bootstrap's next-step instructions", () => {
    expect(BOOTSTRAP).toContain("SELLEROPS_REVIEW_ACCOUNT_SLOT");
  });

  it("preflights the account slot and the backend, which the counting run needed neither of", () => {
    expect(PREFLIGHT).toContain("SELLEROPS_REVIEW_ACCOUNT_SLOT is not set");
    expect(PREFLIGHT).toContain("nowhere to put them");
  });

  it("binds the approved phase from the manifest, not from the env it sourced", () => {
    expect(PREFLIGHT).toContain("SELLEROPS_WING_APPROVED_PHASE");
    expect(PREFLIGHT).toContain('"$RUN_ENV" "$M_PHASE"');
  });

  it("refuses to display a manifest prepared for any other phase", () => {
    expect(PREFLIGHT).toContain('if [ "$M_PHASE" != "$PHASE_EXPECTED" ]');
    expect(PREFLIGHT).toContain('PHASE_EXPECTED="COUPANG_WING_REVIEW_ACQUISITION"');
  });

  it("names the CLI the phase spec names, so the gate and the instructions cannot diverge", () => {
    expect(PREFLIGHT).toContain(`CLI_REL="${PHASE_SPECS.COUPANG_WING_REVIEW_ACQUISITION.cli}"`);
  });

  it("tells the operator, in the manifest display, the four things that bound this run", () => {
    expect(PREFLIGHT).toContain("This run COLLECTS");
    expect(PREFLIGHT).toContain("The buyer is not collected");
    expect(PREFLIGHT).toContain("You turn every page");
    expect(PREFLIGHT).toContain("Re-reading is free");
  });

  it("does not claim the walk can stop early at a page of familiar reviews", () => {
    expect(PREFLIGHT).toContain("walks every page on a RE-collection");
  });
});
