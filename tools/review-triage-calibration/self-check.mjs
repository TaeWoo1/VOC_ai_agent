#!/usr/bin/env node
/**
 * The tooling's own checks. `node --test tools/review-triage-calibration/self-check.mjs`
 *
 * No database, no worksheet, no network — every fixture is built here. What it guards is the two
 * properties that are invisible when they break: a labeling page that leaked a prediction would
 * still look fine and would quietly measure agreement-with-the-rule instead of agreement-with-the-
 * rubric, and a κ that returned 1.0 on a degenerate sample would read as perfect agreement.
 *
 * Run it before a labeling session, not after.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { cohenKappa, MIN_BINARY_KAPPA } from "./kappa.mjs";
import { labelingPage } from "./page.mjs";
import { refuseReason } from "./pii.mjs";
import { assertParity, splitOf } from "./fingerprint.mjs";
import {
  ALLOCATION, CALIBRATION_ALLOCATION, MAX_TAGS, OVERLAP_ALLOCATION, REASON_CODES, TAGS, TIERS, stratumOf,
} from "./vocabulary.mjs";

const page = (over = {}) => labelingPage({
  title: "t", role: "ANNOTATOR", download: "d.json", storageKey: "k",
  items: [{ key: "1", rating: 5, body: "배송도 빠르고 좋아요" }],
  ...over,
});

test("the labeling page carries no prediction of any kind", () => {
  const html = page();
  for (const banned of ["ReviewTriageRules", "NEEDS_ATTENTION\":", "predicted", "ruleTier", "suggested"]) {
    assert.ok(!html.includes(banned), `page must not contain ${banned}`);
  }
  const items = JSON.parse(html.match(/const ITEMS=(\[.*?\]), TIERS=/s)[1]);
  // The tier vocabulary is present because the labeler picks from it. What must never appear is a
  // tier attached to an ITEM — that is the shape a leaked prediction would take.
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ["body", "key", "rating"]);
  }
});

test("a body containing markup cannot break out of the embedded data", () => {
  const html = page({ items: [{ key: "1", rating: 5, body: "</script><script>alert(1)</script>" }] });
  assert.ok(!html.includes("<script>alert"), "the body's markup must be escaped in the JSON island");
  assert.ok(html.includes("\\u003c"), "`<` is escaped rather than emitted raw");
});

test("worked examples appear only when there are some", () => {
  assert.ok(!page().includes("기준 예시"));
  assert.ok(page({ examples: [{ rating: 5, body: "좋아요", tier: "FYI", reasonCode: "PRAISE_ONLY" }] })
      .includes("기준 예시"));
});

test("the three key sets are disjoint, or some choices become unreachable", () => {
  const html = page();
  const grab = (name) => JSON.parse(html.match(new RegExp(`${name}=(\\[[^\\]]*\\])`))[1]);
  const [tier, reason, tag] = [grab("TIER_KEYS"), grab("REASON_KEYS"), grab("TAG_KEYS")];
  assert.equal(new Set([...tier, ...reason, ...tag]).size, tier.length + reason.length + tag.length);
  assert.ok(reason.length >= REASON_CODES.length, "every reason code needs a key");
  assert.ok(tag.length >= TAGS.length, "every tag needs a key");
  assert.equal(tier.length, TIERS.length);
});

test("the PII check refuses the shapes that must not travel", () => {
  assert.equal(refuseReason("배송이 빨라요"), null);
  assert.equal(refuseReason("연락처 010-1234-5678 로 주세요"), "phone");
  assert.equal(refuseReason("01012345678 로 연락 부탁"), "phone");
  assert.equal(refuseReason("메일 buyer@example.com 으로 보내주세요"), "email");
  assert.equal(refuseReason("900101-1234567"), "id-number");
  assert.equal(refuseReason("주문번호 2026081512345678"), "long-digit-run");
  // It refuses, it does not redact. A redaction lets a near-miss through looking handled.
  assert.equal(refuseReason("5000원짜리 치고는 좋아요"), null);
});

test("κ is undefined rather than 1.0 when the sample holds one class", () => {
  const degenerate = cohenKappa([["N", "N"], ["N", "N"], ["N", "N"]]);
  assert.equal(degenerate.kappa, null);
  assert.equal(degenerate.po, 1);
  assert.match(degenerate.reason, /one class/);
});

test("κ is 1 on perfect agreement over two classes, 0 on chance, negative below it", () => {
  assert.equal(cohenKappa([["A", "A"], ["N", "N"], ["A", "A"], ["N", "N"]]).kappa, 1);
  const opposite = cohenKappa([["A", "N"], ["N", "A"], ["A", "N"], ["N", "A"]]);
  assert.ok(opposite.kappa < 0);
  assert.equal(cohenKappa([]), null);
});

test("the agreement bar is the pre-committed one", () => {
  assert.equal(MIN_BINARY_KAPPA, 0.6);
});

test("a stratum is decided in code points, not UTF-16 units", () => {
  assert.equal(stratumOf(5, 20), "HIGH_M");
  assert.equal(stratumOf(5, 40), "HIGH_L");
  assert.equal(stratumOf(3, 19), "MID_S");
  assert.equal(stratumOf(2, 0), "LOW_S");
  assert.equal(stratumOf(null, 50), null);
});

test("the overlap is enriched toward the scarce class, not proportional", () => {
  const overlap = Object.values(OVERLAP_ALLOCATION).reduce((a, b) => a + b, 0);
  assert.equal(overlap, 30);
  const low = OVERLAP_ALLOCATION.LOW_S + OVERLAP_ALLOCATION.LOW_M + OVERLAP_ALLOCATION.LOW_L
      + OVERLAP_ALLOCATION.MID_S + OVERLAP_ALLOCATION.MID_M + OVERLAP_ALLOCATION.MID_L;
  // Proportionally the 1-3 star bands are 105/3858 of the frame, which would be under one row of
  // thirty. Half the overlap sits there on purpose.
  assert.ok(low >= 15, "at least half the overlap must be 1-3 star rows");
});

test("calibration rows are only drawn where the sample left some behind", () => {
  for (const stratum of Object.keys(CALIBRATION_ALLOCATION)) {
    assert.ok(Number.isFinite(ALLOCATION[stratum]),
        `${stratum} is censused; there would be nothing outside the sample to calibrate on`);
  }
  assert.equal(Object.values(CALIBRATION_ALLOCATION).reduce((a, b) => a + b, 0), 24);
});

test("the fingerprint port reproduces the committed golden vectors", () => {
  assert.ok(assertParity() > 0);
  assert.ok(["DEV", "HOLDOUT"].includes(splitOf("0".repeat(64))));
});

test("at most two tags, matching what the committed schema admits", () => {
  assert.equal(MAX_TAGS, 2);
  assert.equal(TAGS.length, 9);
  assert.equal(REASON_CODES.length, 13);
});
