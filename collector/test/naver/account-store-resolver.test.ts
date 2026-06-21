import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCandidateShape,
  buildContinueControl,
  buildHrefStructure,
  candidateMatchesExpected,
  classifyAccountStoreSurface,
  classifyContinuationCard,
  classifyPathSegment,
  classifyQueryKeys,
  continueCardFingerprint,
  decideContinuationCard,
  decideAccountStoreAction,
  matchesSafeContinueHypothesis,
  normalizeContinueCardText,
  pickCandidateIdentity,
  resolverSurfaceFromVerdict,
  SANITIZED_CANDIDATE_SHAPE_KEYS,
  SANITIZED_CONTINUATION_CARD_KEYS,
  SANITIZED_CONTINUE_CONTROL_KEYS,
  SANITIZED_HREF_STRUCTURE_KEYS,
  SANITIZED_PATH_SEGMENT_KEYS,
  SANITIZED_QUERY_STRUCTURE_KEYS,
  SANITIZED_SELECTION_CANDIDATE_KEYS,
  SANITIZED_SELECTION_SIGNAL_KEYS,
  type ExpectedIdentity,
  type RawCandidateShape,
  type RawContinuationCard,
  type RawControlContainment,
  type RawControlMarkers,
  type RawSelectionCandidate,
  type RawSelectionSurface,
  type ResolverSurface,
  type SanitizedCandidateShape,
} from "../../src/naver/account-store-resolver";

const SALT = "test-salt-value";

// Synthetic PII/sensitive strings embedded in raw candidate labels + identity tokens.
// None of these may appear in the sanitized output of the resolver.
const HOSTILE_STRINGS = [
  "달빛코스메틱", // store name
  "햇살스토어", // other store name
  "seller-admin@example-store.co.kr",
  "홍길동", // person name
  "CHN-EXPECTED-7788", // expected channel code (a real id)
  "CHN-OTHER-1234", // other channel code
  "store/expected-store-path", // store-url-path token
  "SECRETTOKEN12345", // token
  "https://sell.smartstore.naver.com/#/store/CHN-EXPECTED-7788?authToken=SECRETTOKEN12345",
];

const EXPECTED: ExpectedIdentity = { expectedChannelCode: "CHN-EXPECTED-7788" };

function fpOf(token: string): string {
  return createHash("sha256").update(`${SALT} ${token}`).digest("hex").slice(0, 16);
}

function candidate(over: Partial<RawSelectionCandidate>): RawSelectionCandidate {
  return {
    identityToken: "CHN-OTHER-1234",
    sourceCategory: "commerce-id",
    visibleText: "햇살스토어",
    clickable: true,
    ...over,
  };
}

function surface(over: Partial<RawSelectionSurface>): RawSelectionSurface {
  return {
    surface: "account-chooser",
    candidates: [],
    inTopDocument: true,
    inChildFrame: false,
    popupPagePresent: false,
    salt: SALT,
    ...over,
  };
}

describe("account-store-resolver — decision tree", () => {
  it("RESOLVED: exactly one verified candidate matches the expected channel code", () => {
    const raw = surface({
      candidates: [
        candidate({ identityToken: "CHN-OTHER-1234", visibleText: "햇살스토어" }),
        candidate({ identityToken: "CHN-EXPECTED-7788", visibleText: "달빛코스메틱" }),
      ],
    });
    const d = decideAccountStoreAction(raw, EXPECTED);
    expect(d.kind).toBe("RESOLVED");
    expect(d.clickCandidateIndex).toBe(1); // index into raw.candidates of the match
  });

  it("RESOLVED: fingerprint match works even without a commerce-id source", () => {
    const expected: ExpectedIdentity = {
      expectedChannelCode: "UNUSED",
      expectedStoreFingerprint: fpOf("store/expected-store-path"),
    };
    const raw = surface({
      candidates: [
        candidate({
          identityToken: "store/expected-store-path",
          sourceCategory: "store-url-path",
          visibleText: "달빛코스메틱",
        }),
      ],
    });
    const d = decideAccountStoreAction(raw, expected);
    expect(d.kind).toBe("RESOLVED");
    expect(d.clickCandidateIndex).toBe(0);
  });

  it("AMBIGUOUS: more than one candidate matches the expected identity", () => {
    const raw = surface({
      candidates: [
        candidate({ identityToken: "CHN-EXPECTED-7788", visibleText: "달빛코스메틱" }),
        candidate({ identityToken: "CHN-EXPECTED-7788", visibleText: "달빛코스메틱(2)" }),
      ],
    });
    expect(decideAccountStoreAction(raw, EXPECTED).kind).toBe("AMBIGUOUS");
  });

  it("AMBIGUOUS: one match but an unidentifiable sibling exists (never risk wrong store)", () => {
    const raw = surface({
      candidates: [
        candidate({ identityToken: "CHN-EXPECTED-7788", visibleText: "달빛코스메틱" }),
        candidate({ identityToken: null, sourceCategory: null, visibleText: "홍길동" }),
      ],
    });
    const d = decideAccountStoreAction(raw, EXPECTED);
    expect(d.kind).toBe("AMBIGUOUS");
    expect(d.clickCandidateIndex).toBeUndefined();
  });

  it("AMBIGUOUS: zero matches but an unreadable candidate identity (never guess)", () => {
    const raw = surface({
      candidates: [
        candidate({ identityToken: "CHN-OTHER-1234", visibleText: "햇살스토어" }),
        candidate({ identityToken: null, sourceCategory: null, visibleText: "홍길동" }),
      ],
    });
    expect(decideAccountStoreAction(raw, EXPECTED).kind).toBe("AMBIGUOUS");
  });

  it("NO_MATCH: candidates present, all verifiable, none matches expected", () => {
    const raw = surface({
      candidates: [
        candidate({ identityToken: "CHN-OTHER-1234", visibleText: "햇살스토어" }),
        candidate({ identityToken: "CHN-OTHER-5678", visibleText: "별빛샵" }),
      ],
    });
    expect(decideAccountStoreAction(raw, EXPECTED).kind).toBe("NO_MATCH");
  });

  it("UNSUPPORTED_SURFACE: selection surface with no readable clickable candidate", () => {
    const raw = surface({
      candidates: [candidate({ clickable: false, identityToken: "CHN-EXPECTED-7788" })],
    });
    expect(decideAccountStoreAction(raw, EXPECTED).kind).toBe("UNSUPPORTED_SURFACE");
  });

  it("UNSUPPORTED_SURFACE: an unknown surface", () => {
    expect(decideAccountStoreAction(surface({ surface: "unknown" }), EXPECTED).kind).toBe(
      "UNSUPPORTED_SURFACE",
    );
  });

  it("ALREADY_READY: the review export page needs no resolution", () => {
    expect(decideAccountStoreAction(surface({ surface: "review-ready" }), EXPECTED).kind).toBe(
      "ALREADY_READY",
    );
  });

  it("LOGIN_REQUIRED / AUTH_CHALLENGE_REQUIRED stop-and-ask surfaces never click", () => {
    expect(decideAccountStoreAction(surface({ surface: "login" }), EXPECTED).kind).toBe(
      "LOGIN_REQUIRED",
    );
    const auth = decideAccountStoreAction(surface({ surface: "auth-challenge" }), EXPECTED);
    expect(auth.kind).toBe("AUTH_CHALLENGE_REQUIRED");
    expect(auth.clickCandidateIndex).toBeUndefined();
  });

  it("a non-clickable matching candidate alongside a clickable match still resolves to the clickable one", () => {
    const raw = surface({
      candidates: [
        candidate({ clickable: false, identityToken: "CHN-EXPECTED-7788", visibleText: "달빛코스메틱" }),
        candidate({ clickable: true, identityToken: "CHN-EXPECTED-7788", visibleText: "달빛코스메틱" }),
      ],
    });
    const d = decideAccountStoreAction(raw, EXPECTED);
    // The non-clickable card is ignored for the click target; the clickable match wins.
    expect(d.kind).toBe("RESOLVED");
    expect(d.clickCandidateIndex).toBe(1);
  });
});

describe("account-store-resolver — candidateMatchesExpected", () => {
  it("matches a commerce-id token equal to the expected channel code", () => {
    expect(
      candidateMatchesExpected(
        candidate({ identityToken: "CHN-EXPECTED-7788", sourceCategory: "commerce-id" }),
        EXPECTED,
        SALT,
      ),
    ).toBe(true);
  });

  it("does NOT match a non-commerce-id token even if its value equals the channel code", () => {
    expect(
      candidateMatchesExpected(
        candidate({ identityToken: "CHN-EXPECTED-7788", sourceCategory: "store-url-path" }),
        EXPECTED,
        SALT,
      ),
    ).toBe(false);
  });

  it("never matches a candidate with no readable identity token", () => {
    expect(
      candidateMatchesExpected(candidate({ identityToken: null, sourceCategory: null }), EXPECTED, SALT),
    ).toBe(false);
  });
});

describe("account-store-resolver — pickCandidateIdentity precedence", () => {
  it("prefers commerce-id over store-url-path over account-scope", () => {
    expect(
      pickCandidateIdentity({ commerceId: "C", storeUrlPath: "S", accountScope: "A" }),
    ).toEqual({ identityToken: "C", sourceCategory: "commerce-id" });
    expect(
      pickCandidateIdentity({ commerceId: null, storeUrlPath: "S", accountScope: "A" }),
    ).toEqual({ identityToken: "S", sourceCategory: "store-url-path" });
    expect(
      pickCandidateIdentity({ commerceId: null, storeUrlPath: null, accountScope: "A" }),
    ).toEqual({ identityToken: "A", sourceCategory: "account-scope" });
  });

  it("returns null token/category when nothing stable is readable (never guess)", () => {
    expect(
      pickCandidateIdentity({ commerceId: null, storeUrlPath: null, accountScope: null }),
    ).toEqual({ identityToken: null, sourceCategory: null });
    // Empty strings are treated as unreadable.
    expect(
      pickCandidateIdentity({ commerceId: "", storeUrlPath: "", accountScope: "" }),
    ).toEqual({ identityToken: null, sourceCategory: null });
  });
});

describe("account-store-resolver — resolverSurfaceFromVerdict", () => {
  const noMarkers = { storeSelectMarkerPresent: false, accountSelectMarkerPresent: false };

  it("maps the auth/ready/unknown verdicts straight through", () => {
    expect(resolverSurfaceFromVerdict("LOGGED_IN", noMarkers)).toBe("review-ready");
    expect(resolverSurfaceFromVerdict("AUTH_CHALLENGE_REQUIRED", noMarkers)).toBe("auth-challenge");
    expect(resolverSurfaceFromVerdict("ACCOUNT_LOGIN_REQUIRED", noMarkers)).toBe("login");
    expect(resolverSurfaceFromVerdict("UNKNOWN", noMarkers)).toBe("unknown");
  });

  it("sub-labels a RECONNECT_REQUIRED surface by marker, else reconnect-continue", () => {
    expect(
      resolverSurfaceFromVerdict("RECONNECT_REQUIRED", {
        storeSelectMarkerPresent: true,
        accountSelectMarkerPresent: false,
      }),
    ).toBe("store-chooser");
    expect(
      resolverSurfaceFromVerdict("RECONNECT_REQUIRED", {
        storeSelectMarkerPresent: false,
        accountSelectMarkerPresent: true,
      }),
    ).toBe("account-chooser");
    expect(resolverSurfaceFromVerdict("RECONNECT_REQUIRED", noMarkers)).toBe("reconnect-continue");
  });
});

describe("account-store-resolver — sanitized signals never leak raw values", () => {
  function fullSurface(s: ResolverSurface): RawSelectionSurface {
    return surface({
      surface: s,
      candidates: [
        candidate({
          identityToken: "CHN-EXPECTED-7788",
          sourceCategory: "commerce-id",
          visibleText: "달빛코스메틱 seller-admin@example-store.co.kr",
        }),
        candidate({
          identityToken: "store/expected-store-path",
          sourceCategory: "store-url-path",
          visibleText: "햇살스토어 홍길동",
        }),
        candidate({ identityToken: null, sourceCategory: null, visibleText: "SECRETTOKEN12345" }),
      ],
      inChildFrame: true,
      popupPagePresent: true,
      inTopDocument: false,
    });
  }

  it("output contains none of the raw PII / token / id strings", () => {
    const signals = classifyAccountStoreSurface(fullSurface("account-chooser"), EXPECTED);
    const serialized = JSON.stringify(signals);
    for (const s of HOSTILE_STRINGS) {
      expect(serialized).not.toContain(s);
    }
    expect(serialized).not.toContain("authToken");
  });

  it("emits ONLY the allowed top-level + candidate keys", () => {
    const signals = classifyAccountStoreSurface(fullSurface("store-chooser"), EXPECTED);
    expect(Object.keys(signals).sort()).toEqual([...SANITIZED_SELECTION_SIGNAL_KEYS].sort());
    for (const c of signals.candidates) {
      expect(Object.keys(c).sort()).toEqual([...SANITIZED_SELECTION_CANDIDATE_KEYS].sort());
    }
  });

  it("every candidate textHash is a 16-char hex digest, not the label", () => {
    const signals = classifyAccountStoreSurface(fullSurface("reconnect-continue"), EXPECTED);
    for (const c of signals.candidates) {
      expect(c.textHash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("buckets counts and reports the decision kind + frame/popup booleans", () => {
    const signals = classifyAccountStoreSurface(fullSurface("account-chooser"), EXPECTED);
    expect(signals.candidateCount).toBe("few"); // 3 candidates → few
    expect(signals.matchCount).toBe("one"); // exactly one clickable match (commerce-id)
    expect(signals.inChildFrame).toBe(true);
    expect(signals.popupPagePresent).toBe(true);
    expect(signals.inTopDocument).toBe(false);
    // The null-identity sibling downgrades the single match to AMBIGUOUS.
    expect(signals.decisionKind).toBe("AMBIGUOUS");
  });

  it("the salt itself never appears in the output", () => {
    const signals = classifyAccountStoreSurface(fullSurface("account-chooser"), EXPECTED);
    expect(JSON.stringify(signals)).not.toContain(SALT);
  });
});

describe("account-store-resolver — buildCandidateShape (report-only structural diagnostic)", () => {
  function rawShape(over: Partial<RawCandidateShape>): RawCandidateShape {
    return {
      tagCategory: "button",
      roleCategory: "option",
      clickableTagCategory: "button",
      hasHref: false,
      hasButton: true,
      hasAnchor: false,
      hasInput: false,
      hasRadio: false,
      hasImage: true,
      hasSvg: false,
      hasAriaLabel: true,
      hasTitleAttr: false,
      hasDataAttrs: true,
      hasDataAttrNameChannelLike: true,
      hasDataAttrNameStoreLike: false,
      hasDataAttrNameAccountLike: false,
      hasDataAttrNameCommerceLike: false,
      hasIdAttr: true,
      hasClassAttr: true,
      hasNameAttr: false,
      hasValueAttr: false,
      hasOnClickAttr: false,
      hasNestedLink: false,
      hasNestedButton: false,
      dataAttrCount: 3,
      classTokenCount: 7,
      childElementCount: 0,
      linkCount: 1,
      buttonCount: 21,
      hrefCategory: "naver-commerce",
      hrefPathSegmentCount: 1,
    };
  }

  it("buckets every count and passes booleans/enums through unchanged", () => {
    const shape = buildCandidateShape(2, "abc123def4567890", rawShape({}));
    expect(shape.candidateIndex).toBe(2);
    expect(shape.textHash).toBe("abc123def4567890");
    expect(shape.dataAttrCountBucket).toBe("few"); // 3
    expect(shape.classTokenCountBucket).toBe("some"); // 7
    expect(shape.childElementCountBucket).toBe("none"); // 0
    expect(shape.linkCountBucket).toBe("one"); // 1
    expect(shape.buttonCountBucket).toBe("many"); // 21
    expect(shape.hrefPathSegmentCountBucket).toBe("one"); // 1
    expect(shape.hrefCategory).toBe("naver-commerce");
    expect(shape.tagCategory).toBe("button");
    expect(shape.roleCategory).toBe("option");
    expect(shape.hasDataAttrNameChannelLike).toBe(true);
    // No raw count fields survive into the sanitized shape.
    expect(shape).not.toHaveProperty("dataAttrCount");
    expect(shape).not.toHaveProperty("childElementCount");
  });

  it("emits ONLY the allow-listed shape keys", () => {
    const shape = buildCandidateShape(0, "0000000000000000", rawShape({}));
    expect(Object.keys(shape).sort()).toEqual([...SANITIZED_CANDIDATE_SHAPE_KEYS].sort());
  });

  it("every value is a boolean, a number index, or a fixed bucket/category string (no free strings)", () => {
    const shape = buildCandidateShape(5, "ffffffffffffffff", rawShape({ hrefCategory: "external" }));
    const COUNT_BUCKETS = ["none", "one", "few", "some", "many"];
    const HREF_CATS = ["none", "same-origin", "naver-commerce", "naver-login", "external", "other"];
    const TAG_CATS = ["button", "a", "input", "li", "div", "span", "other", "none"];
    const ROLE_CATS = ["button", "option", "listitem", "link", "none", "other"];
    for (const [key, value] of Object.entries(shape)) {
      if (key === "candidateIndex") expect(typeof value).toBe("number");
      else if (key === "textHash") expect(value).toMatch(/^[0-9a-f]{16}$/);
      else if (key.endsWith("Bucket")) expect(COUNT_BUCKETS).toContain(value);
      else if (key === "hrefCategory") expect(HREF_CATS).toContain(value);
      else if (key === "tagCategory" || key === "clickableTagCategory") expect(TAG_CATS).toContain(value);
      else if (key === "roleCategory") expect(ROLE_CATS).toContain(value);
      else expect(typeof value).toBe("boolean"); // every remaining field is a presence boolean
    }
  });
});

describe("account-store-resolver — href-structure classifiers", () => {
  it("classifyPathSegment: numeric id", () => {
    expect(classifyPathSegment("1234567")).toEqual({
      segmentKind: "numericLike",
      segmentLengthBucket: "short",
      charsetCategory: "digits",
      keywordCategory: "none",
    });
  });

  it("classifyPathSegment: a known keyword segment is keyword-like and carries its family", () => {
    const channel = classifyPathSegment("channel");
    expect(channel.segmentKind).toBe("knownKeywordLike");
    expect(channel.keywordCategory).toBe("channel");
    const seller = classifyPathSegment("seller");
    expect(seller.segmentKind).toBe("knownKeywordLike");
    expect(seller.keywordCategory).toBe("seller");
  });

  it("classifyPathSegment: uuid / alnum-id / slug / short text", () => {
    expect(classifyPathSegment("550e8400-e29b-41d4-a716-446655440000").segmentKind).toBe("uuidLike");
    expect(classifyPathSegment("ab12cd34ef").segmentKind).toBe("alnumIdLike"); // letters+digits, len>=6
    const slug = classifyPathSegment("my-store-name");
    expect(slug.segmentKind).toBe("slugLike");
    expect(slug.charsetCategory).toBe("slug");
    expect(classifyPathSegment("home").segmentKind).toBe("knownKeywordLike");
    expect(classifyPathSegment("xyz").segmentKind).toBe("shortTextLike");
  });

  it("classifyPathSegment: empty segment", () => {
    expect(classifyPathSegment("").segmentKind).toBe("empty");
    expect(classifyPathSegment("").segmentLengthBucket).toBe("empty");
  });

  it("classifyQueryKeys: flags channel/store/account/commerce/seller/returnUrl by KEY NAME only", () => {
    const q = classifyQueryKeys(["channelNo", "returnUrl", "sellerId", "storeName"]);
    expect(q.hasQueryKeyChannelLike).toBe(true);
    expect(q.hasQueryKeyReturnUrlLike).toBe(true);
    expect(q.hasQueryKeySellerLike).toBe(true);
    expect(q.hasQueryKeyStoreLike).toBe(true);
    expect(q.hasQueryKeyCommerceLike).toBe(false);
    expect(q.queryParamCountBucket).toBe("few"); // 4
  });

  it("buildHrefStructure assembles indexed segments + query, only allow-listed keys", () => {
    const s = buildHrefStructure(
      3,
      "abcdef0123456789",
      "naver-commerce",
      ["seller", "channel", "1234567"],
      ["returnUrl"],
    );
    expect(Object.keys(s).sort()).toEqual([...SANITIZED_HREF_STRUCTURE_KEYS].sort());
    expect(s.candidateIndex).toBe(3);
    expect(s.pathSegmentCountBucket).toBe("few"); // 3 segments
    expect(s.segments.map((seg) => seg.segmentIndex)).toEqual([0, 1, 2]);
    expect(s.segments[1]!.keywordCategory).toBe("channel"); // "channel" keyword segment
    expect(s.segments[2]!.segmentKind).toBe("numericLike"); // the id follows it
    for (const seg of s.segments) {
      expect(Object.keys(seg).sort()).toEqual([...SANITIZED_PATH_SEGMENT_KEYS].sort());
    }
    expect(Object.keys(s.query).sort()).toEqual([...SANITIZED_QUERY_STRUCTURE_KEYS].sort());
  });

  it("no-leak: raw path segments / query key names never appear in the sanitized output", () => {
    const HOSTILE = [
      "1234567", // store/channel id
      "달빛코스메틱storepath", // store-name-like segment
      "SECRETSTORE-9988", // id-like segment
      "authToken", // query key carrying a token
      "X-Csrf-Secret", // query key
    ];
    const s = buildHrefStructure(
      0,
      "0000000000000000",
      "naver-commerce",
      ["1234567", "달빛코스메틱storepath", "SECRETSTORE-9988"],
      ["authToken", "X-Csrf-Secret", "channelNo"],
    );
    const serialized = JSON.stringify(s);
    for (const h of HOSTILE) {
      expect(serialized).not.toContain(h);
    }
  });
});

describe("account-store-resolver — continuation-card diagnostic", () => {
  const SALT2 = "card-salt";
  // A realistic raw card string carrying account PII that must never surface.
  const RAW_CARD = "  현재 로그인 중인\n  커머스 ID: 달빛코스메틱 (gildong@example.com)  ";

  function rawCard(over: Partial<RawContinuationCard>): RawContinuationCard {
    return {
      surface: "reconnect-continue",
      continueControlCount: 1,
      cardText: RAW_CARD,
      hasCurrentLoginAccountCard: true,
      hasNaverCommerceIdMarker: true,
      hasNaverIdMarker: false,
      salt: SALT2,
      ...over,
    };
  }

  it("normalizeContinueCardText trims + collapses whitespace deterministically", () => {
    expect(normalizeContinueCardText("  a   b\n\tc  ")).toBe("a b c");
    // Stability: re-normalizing is idempotent; whitespace variants collapse to the same form.
    expect(normalizeContinueCardText("a\n\nb")).toBe(normalizeContinueCardText("a   b"));
    expect(normalizeContinueCardText("")).toBe("");
  });

  it("continueCardFingerprint is stable across whitespace variants and salt-dependent", () => {
    const a = continueCardFingerprint(SALT2, "현재 로그인 중인  커머스 ID");
    const b = continueCardFingerprint(SALT2, "  현재 로그인 중인\n커머스 ID  ");
    expect(a).toBe(b); // whitespace-normalized → same hash
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(continueCardFingerprint("other-salt", "현재 로그인 중인 커머스 ID")).not.toBe(a);
  });

  it("absent expected fingerprint → CONTINUATION_CARD_DETECTED (reports hash, never READY)", () => {
    const d = decideContinuationCard(rawCard({}), {});
    expect(d.kind).toBe("CONTINUATION_CARD_DETECTED");
  });

  it("expected match + exactly one continue control → READY_TO_CONTINUE", () => {
    const fp = continueCardFingerprint(SALT2, RAW_CARD);
    const d = decideContinuationCard(rawCard({ continueControlCount: 1 }), { expectedCardFingerprint: fp });
    expect(d.kind).toBe("READY_TO_CONTINUE");
  });

  it("expected match but multiple safe continue controls → AMBIGUOUS", () => {
    const fp = continueCardFingerprint(SALT2, RAW_CARD);
    const d = decideContinuationCard(rawCard({ continueControlCount: 3 }), { expectedCardFingerprint: fp });
    expect(d.kind).toBe("AMBIGUOUS");
  });

  it("expected match but ZERO safe continue controls → AMBIGUOUS (never ready without a control)", () => {
    const fp = continueCardFingerprint(SALT2, RAW_CARD);
    const d = decideContinuationCard(rawCard({ continueControlCount: 0 }), { expectedCardFingerprint: fp });
    expect(d.kind).toBe("AMBIGUOUS");
  });

  it("fingerprint mismatch → NO_MATCH", () => {
    const d = decideContinuationCard(rawCard({}), { expectedCardFingerprint: "deadbeefdeadbeef" });
    expect(d.kind).toBe("NO_MATCH");
  });

  it("login / auth-challenge surfaces map to stop-and-ask", () => {
    expect(decideContinuationCard(rawCard({ surface: "login" }), {}).kind).toBe("LOGIN_REQUIRED");
    expect(decideContinuationCard(rawCard({ surface: "auth-challenge" }), {}).kind).toBe(
      "AUTH_CHALLENGE_REQUIRED",
    );
  });

  it("non-continuation surfaces are UNSUPPORTED for this diagnostic", () => {
    expect(decideContinuationCard(rawCard({ surface: "review-ready" }), {}).kind).toBe("UNSUPPORTED_SURFACE");
    expect(decideContinuationCard(rawCard({ surface: "store-chooser" }), {}).kind).toBe("UNSUPPORTED_SURFACE");
  });

  it("no readable card or control on a reconnect surface → UNSUPPORTED_SURFACE", () => {
    const d = decideContinuationCard(
      rawCard({
        hasCurrentLoginAccountCard: false,
        hasNaverCommerceIdMarker: false,
        hasNaverIdMarker: false,
        continueControlCount: 0,
        cardText: "",
      }),
      {},
    );
    expect(d.kind).toBe("UNSUPPORTED_SURFACE");
  });

  it("classifyContinuationCard emits ONLY allow-listed keys and leaks no raw card text", () => {
    const card = classifyContinuationCard(rawCard({}), {});
    expect(Object.keys(card).sort()).toEqual([...SANITIZED_CONTINUATION_CARD_KEYS].sort());
    const serialized = JSON.stringify(card);
    for (const leak of ["현재 로그인 중인", "달빛코스메틱", "gildong@example.com", "커머스 ID", SALT2]) {
      expect(serialized).not.toContain(leak);
    }
    expect(card.cardTextHash).toMatch(/^[0-9a-f]{16}$/);
    expect(card.continueControlCountBucket).toBe("one");
    expect(card.hasExactlyOneLikelyContinueControl).toBe(true);
  });

  it("expectedMatch is reported as a boolean and reflects the configured fingerprint", () => {
    const fp = continueCardFingerprint(SALT2, RAW_CARD);
    expect(classifyContinuationCard(rawCard({}), { expectedCardFingerprint: fp }).expectedMatch).toBe(true);
    expect(classifyContinuationCard(rawCard({}), {}).expectedMatch).toBe(false);
  });
});

describe("account-store-resolver — continue-control diagnostic", () => {
  function shape(over: Partial<SanitizedCandidateShape>): SanitizedCandidateShape {
    return {
      candidateIndex: 1,
      textHash: "1111222233334444",
      tagCategory: "button",
      roleCategory: "none",
      clickableTagCategory: "button",
      hasHref: false,
      hasButton: true,
      hasAnchor: false,
      hasInput: false,
      hasRadio: false,
      hasImage: false,
      hasSvg: false,
      hasAriaLabel: true,
      hasTitleAttr: false,
      hasDataAttrs: false,
      hasDataAttrNameChannelLike: false,
      hasDataAttrNameStoreLike: false,
      hasDataAttrNameAccountLike: false,
      hasDataAttrNameCommerceLike: false,
      hasIdAttr: false,
      hasClassAttr: true,
      hasNameAttr: false,
      hasValueAttr: false,
      hasOnClickAttr: false,
      hasNestedLink: false,
      hasNestedButton: false,
      dataAttrCountBucket: "none",
      classTokenCountBucket: "few",
      childElementCountBucket: "one",
      linkCountBucket: "none",
      buttonCountBucket: "none",
      hrefCategory: "none",
      hrefPathSegmentCountBucket: "none",
      ...over,
    };
  }
  function makeMarkers(over: Partial<RawControlMarkers> = {}): RawControlMarkers {
    return {
      continueLike: true,
      loginLike: true,
      accountLike: false,
      naverLike: true,
      commerceLike: false,
      differentAccount: false,
      differentId: false,
      otherLogin: false,
      switchAccount: false,
      logout: false,
      currentAccount: true,
      continueCurrent: true,
      loginCurrent: false,
      ...over,
    };
  }
  function makeContainment(over: Partial<RawControlContainment> = {}): RawControlContainment {
    return {
      isWithinContinuationCard: true,
      isNearContinuationCard: true,
      cardAncestorDepth: 2,
      nearestCardMarkerCategory: "currentLogin",
      ...over,
    };
  }
  const markers = makeMarkers();
  const containment = makeContainment();

  it("combines the sanitized shape subset with the marker + containment booleans", () => {
    const ctrl = buildContinueControl(shape({}), markers, containment);
    expect(ctrl.candidateIndex).toBe(1);
    expect(ctrl.textHash).toBe("1111222233334444");
    expect(ctrl.tagCategory).toBe("button");
    expect(ctrl.classTokenCountBucket).toBe("few");
    expect(ctrl.hasContinueLikeMarker).toBe(true);
    expect(ctrl.hasLoginLikeMarker).toBe(true);
    expect(ctrl.isWithinContinuationCard).toBe(true);
    expect(ctrl.sameCardAncestorDepthBucket).toBe("few"); // depth 2 → few
    expect(ctrl.nearestCardMarkerCategory).toBe("currentLogin");
    expect(ctrl.hasDifferentAccountMarker).toBe(false);
    expect(ctrl.hasCurrentAccountMarker).toBe(true);
  });

  it("emits ONLY the allow-listed keys (no shape fields outside the requested subset)", () => {
    const ctrl = buildContinueControl(shape({}), markers, containment);
    expect(Object.keys(ctrl).sort()).toEqual([...SANITIZED_CONTINUE_CONTROL_KEYS].sort());
    // The detailed data-attr-name shape fields are intentionally NOT carried here.
    expect(ctrl).not.toHaveProperty("hasDataAttrNameChannelLike");
    expect(ctrl).not.toHaveProperty("hasOnClickAttr");
  });

  it("every value is a boolean, an index, or a fixed bucket/category string (no free strings)", () => {
    const ctrl = buildContinueControl(shape({ hrefCategory: "naver-login" }), markers, containment);
    const COUNT_BUCKETS = ["none", "one", "few", "some", "many"];
    const HREF_CATS = ["none", "same-origin", "naver-commerce", "naver-login", "external", "other"];
    const TAG_CATS = ["button", "a", "input", "li", "div", "span", "other", "none"];
    const ROLE_CATS = ["button", "option", "listitem", "link", "none", "other"];
    const CARD_MARKER_CATS = ["currentLogin", "commerceId", "naverId", "none"];
    for (const [key, value] of Object.entries(ctrl)) {
      if (key === "candidateIndex") expect(typeof value).toBe("number");
      else if (key === "textHash") expect(value).toMatch(/^[0-9a-f]{16}$/);
      else if (key.endsWith("Bucket")) expect(COUNT_BUCKETS).toContain(value);
      else if (key === "hrefCategory") expect(HREF_CATS).toContain(value);
      else if (key === "tagCategory" || key === "clickableTagCategory") expect(TAG_CATS).toContain(value);
      else if (key === "roleCategory") expect(ROLE_CATS).toContain(value);
      else if (key === "nearestCardMarkerCategory") expect(CARD_MARKER_CATS).toContain(value);
      else expect(typeof value).toBe("boolean");
    }
  });

  it("matchesSafeContinueHypothesis: login-like + within/near card + no alternate/switch/logout", () => {
    // The exact target rule: passes for a login control inside the card with no negatives.
    expect(matchesSafeContinueHypothesis(makeMarkers(), makeContainment())).toBe(true);
    // near (not within) still qualifies.
    expect(
      matchesSafeContinueHypothesis(
        makeMarkers(),
        makeContainment({ isWithinContinuationCard: false, isNearContinuationCard: true }),
      ),
    ).toBe(true);
  });

  it("matchesSafeContinueHypothesis: rejected by any negative marker or by being outside the card", () => {
    expect(matchesSafeContinueHypothesis(makeMarkers({ loginLike: false }), makeContainment())).toBe(false);
    expect(matchesSafeContinueHypothesis(makeMarkers({ differentAccount: true }), makeContainment())).toBe(false);
    expect(matchesSafeContinueHypothesis(makeMarkers({ otherLogin: true }), makeContainment())).toBe(false);
    expect(matchesSafeContinueHypothesis(makeMarkers({ switchAccount: true }), makeContainment())).toBe(false);
    expect(matchesSafeContinueHypothesis(makeMarkers({ logout: true }), makeContainment())).toBe(false);
    expect(
      matchesSafeContinueHypothesis(
        makeMarkers(),
        makeContainment({ isWithinContinuationCard: false, isNearContinuationCard: false }),
      ),
    ).toBe(false);
  });

  it("the derived hypothesis field on the built control matches the pure predicate", () => {
    const safe = buildContinueControl(shape({}), makeMarkers(), makeContainment());
    expect(safe.matchesSafeContinueHypothesis).toBe(true);
    const alt = buildContinueControl(shape({}), makeMarkers({ differentAccount: true }), makeContainment());
    expect(alt.matchesSafeContinueHypothesis).toBe(false);
  });
});
