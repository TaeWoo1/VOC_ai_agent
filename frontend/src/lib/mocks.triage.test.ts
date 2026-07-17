import { beforeEach, describe, expect, it } from "vitest";
import {
  mockAccountArticles,
  mockAccountAttention,
  mockAccountDashboard,
  mockAttentionItems,
  mockVocItemTriage,
  resetMockTriageDecisions,
} from "./mocks";

// Demo fixtures are a claim about what the product can do. These pin the claim to the real
// capability: triage is anchored on the ingested-REVIEW store, which serves NAVER only, so
// a ref may appear on a NAVER review row and nowhere else. A fixture that overreaches
// demos a feature that does not exist; one that under-reaches makes a working feature look
// broken.

const WINDOW = { from: "2026-05-01", to: "2026-05-31" };

// Real demo account ids: mockSellerAccounts mints `mock-acct-<channelId>`, and the channel is
// derived from the id. Using a placeholder like "acct" is why the account-blind mock went
// unnoticed for so long — it matched no channel, so every assertion ran against the
// fallback rather than against a real account.
const NAVER_ACCOUNT = "mock-acct-mock-channel-1";
const COUPANG_ACCOUNT = "mock-acct-mock-channel-0";

function rows(type: string) {
  return mockAttentionItems(NAVER_ACCOUNT, { type, ...WINDOW }, 0, 20).items;
}

// The store is module-level (it has to survive unmount), so it leaks between tests unless
// each one starts from the seeded fixture.
beforeEach(() => {
  resetMockTriageDecisions();
});

/** Signals NAVER's source can raise; the rest are hard-zero and can never fire. */
const NAVER_SIGNALS = ["LOW_RATING_REVIEW", "NEW_REVIEW", "RECENT_REVIEW_SPIKE_CANDIDATE"];
const INQUIRY_SIGNALS = [
  "UNANSWERED_INQUIRY",
  "NEW_INQUIRY",
  "UNKNOWN_REPLY_STATUS",
  "RECENT_INQUIRY_SPIKE_CANDIDATE",
];

describe("mock channel consistency", () => {
  it("puts the account, its summary, and every drill-down row on the same channel", () => {
    // A SellerAccount is bound to one channelId, so a summary claiming one channel over
    // rows claiming another describes an account that cannot exist. An earlier fixture did
    // exactly that — 카페24 summary, alternating NAVER/CAFE24 rows.
    const summary = mockAccountAttention(NAVER_ACCOUNT, WINDOW);
    expect(summary.channel).toBe("네이버 스마트스토어");

    for (const signal of summary.items) {
      expect(signal.channel).toBe("네이버 스마트스토어");
    }
    for (const type of NAVER_SIGNALS) {
      for (const item of rows(type)) {
        expect(item.channelCode).toBe("NAVER");
        expect(item.channelNameKo).toBe("네이버 스마트스토어");
      }
    }
  });

  // The invariant, over BOTH connected accounts: whatever channel an account is on, every
  // pane rendered for that accountId agrees. ChannelDetail mounts the dashboard card and
  // the attention pane side by side, and neither renders its channel — which is exactly why
  // they drifted apart twice without anyone seeing it.
  it.each([
    [NAVER_ACCOUNT, "네이버 스마트스토어", "mock-channel-1"],
    [COUPANG_ACCOUNT, "쿠팡", "mock-channel-0"],
  ])("agrees on the channel across dashboard and Attention for %s", (account, name, channelId) => {
    const dash = mockAccountDashboard(account, WINDOW);
    const attention = mockAccountAttention(account, WINDOW);

    expect(dash.channelNameKo).toBe(name);
    expect(dash.channelId).toBe(channelId);
    expect(dash.sellerAccountId).toBe(account);
    // The two panes, for one account, must name the same channel.
    expect(dash.channelNameKo).toBe(attention.channel);
    // ...and so must every row the same account drills to.
    for (const item of mockAttentionItems(account, { type: "LOW_RATING_REVIEW", ...WINDOW }, 0, 20).items) {
      expect(item.channelNameKo).toBe(name);
    }
  });

  it("never reports NAVER on the Coupang dashboard", () => {
    // The regression, stated as the thing that was actually wrong: this mock hardcoded
    // NAVER for every accountId, so the 쿠팡 account's dashboard claimed 네이버 스마트스토어
    // beside a 쿠팡 attention pane — one account, two channels.
    const dash = mockAccountDashboard(COUPANG_ACCOUNT, WINDOW);

    expect(dash.channelNameKo).not.toBe("네이버 스마트스토어");
    expect(dash.channelId).not.toBe("mock-channel-1");
    expect(dash.channelNameKo).toBe("쿠팡");
  });

  it("claims no channel for an account it cannot resolve", () => {
    // Wrong-shaped input in, honest "I don't know" out — never a default that quietly
    // picks a channel.
    expect(mockAccountDashboard("not-a-demo-account", WINDOW).channelNameKo).toBeNull();
  });

  it("reports zero VOC on the panes a NAVER account cannot fill", () => {
    // The dashboard's VOC counts and the article list both read the Cafe24 community-article
    // store, which only Cafe24ApiConnector writes. NAVER reviews arrive by file upload into
    // `reviews` and never land there — so for a real NAVER account these panes are genuinely
    // empty, and any number here would be invented.
    const dash = mockAccountDashboard(NAVER_ACCOUNT, WINDOW);
    expect(dash.newReviews).toBe(0);
    expect(dash.newInquiries).toBe(0);
    expect(dash.unansweredInquiries).toBe(0);

    for (const type of ["REVIEW", "INQUIRY"]) {
      const page = mockAccountArticles(type, 0, 10);
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    }
  });

  it("does not mirror the attention counts into the dashboard", () => {
    // The attention pane says 12 new reviews; the dashboard says 0. That is not a bug to
    // "fix" by matching them — they read different stores, and making the page look coherent
    // would fake a relationship the backend does not have.
    const attentionNewReviews = mockAccountAttention(NAVER_ACCOUNT, WINDOW).items.find(
      (s) => s.type === "NEW_REVIEW",
    )!.count;
    expect(attentionNewReviews).toBe(12);
    expect(mockAccountDashboard(NAVER_ACCOUNT, WINDOW).newReviews).toBe(0);
  });
});

describe("the account decides the channel", () => {
  it("does not show NAVER Attention on the Coupang account", () => {
    // The regression. The demo has TWO connected accounts, and this mock used to hardcode
    // NAVER for both — so opening 쿠팡 showed a 쿠팡 header above a 네이버 스마트스토어
    // attention pane with NAVER rows underneath. One account is one channel; that pane
    // described an account that cannot exist.
    const summary = mockAccountAttention(COUPANG_ACCOUNT, WINDOW);

    expect(summary.channel).toBe("쿠팡");
    expect(summary.channel).not.toBe("네이버 스마트스토어");
    // COUPANG has no VocItemSource, so the registry resolves none → EMPTY_SNAPSHOT → the
    // rules gate every signal on `> 0` → nothing. An honest empty state, not a null pane:
    // the channel name is still reported, because the service reads it before the lookup.
    expect(summary.items).toEqual([]);
    expect(summary.sellerAccountId).toBe(COUPANG_ACCOUNT);
  });

  it("does not drill NAVER rows on the Coupang account either", () => {
    // The drill-down is the summary's neighbour. Unreachable through the UI (the pane above
    // raises no card), but a direct call must not hand back another account's reviews.
    for (const type of NAVER_SIGNALS) {
      const page = mockAttentionItems(COUPANG_ACCOUNT, { type, ...WINDOW }, 0, 20);
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    }
  });

  it("reports no channel for an account it cannot resolve", () => {
    // Mirrors the service: `channel == null ? null : channel.getNameKo()`.
    const summary = mockAccountAttention("not-a-demo-account", WINDOW);
    expect(summary.channel).toBeNull();
    expect(summary.items).toEqual([]);
  });
});

describe("mockAccountAttention signals", () => {
  it("raises only signals the NAVER ingested-review source can actually emit", () => {
    // IngestedReviewVocItemSource serves NAVER alone, holds no inquiries, and passes a
    // literal 0 for every inquiry count; AttentionSignalRules gates each inquiry signal on
    // `> 0`. So an inquiry card on a NAVER account is a card the product cannot produce —
    // this fixture used to show three of them.
    const types = mockAccountAttention(NAVER_ACCOUNT, WINDOW).items.map((s) => s.type);

    for (const inquirySignal of INQUIRY_SIGNALS) {
      expect(types).not.toContain(inquirySignal);
    }
    expect(new Set(types)).toEqual(new Set(NAVER_SIGNALS));
    expect(mockAccountAttention(NAVER_ACCOUNT, WINDOW).items.every((s) => s.sourceType === "REVIEW")).toBe(true);
  });

  it("emits LOW_RATING_REVIEW twice — one type, two severities — as the rules do", () => {
    // The 1~2점 and 3점 cards share one signal type and both drill to the combined 1~3점
    // set. Pinned because it is surprising, and because the drill-down total exceeding a
    // card's count reads as a bug until you know it.
    const low = mockAccountAttention(NAVER_ACCOUNT, WINDOW).items.filter((s) => s.type === "LOW_RATING_REVIEW");
    expect(low.map((s) => s.severity)).toEqual(["HIGH", "MEDIUM"]);
    expect(rows("LOW_RATING_REVIEW").length).toBeGreaterThan(low[0].count);
  });

  it("uses the rules' own label and description verbatim", () => {
    // The card renders `description`, so an invented sentence is one the product never
    // says. Pinned as literals against AttentionSignalRules.
    const byType = (t: string, sev: string) =>
      mockAccountAttention(NAVER_ACCOUNT, WINDOW).items.find((s) => s.type === t && s.severity === sev)!;

    expect(byType("LOW_RATING_REVIEW", "HIGH").description).toBe(
      "불만족 리뷰입니다. 내용을 확인하고 대응을 검토하세요.",
    );
    expect(byType("LOW_RATING_REVIEW", "MEDIUM").description).toBe(
      "개선 여지가 있는 리뷰입니다. 확인을 권장합니다.",
    );
    expect(byType("NEW_REVIEW", "LOW").description).toBe("기간 내 새로 수집된 리뷰입니다.");
    // The spike's description is the only INTERPOLATED one, and the only signal carrying a
    // SpikeComparison — so it is the one most able to drift and was the one left unpinned.
    expect(byType("RECENT_REVIEW_SPIKE_CANDIDATE", "MEDIUM").description).toBe(
      "선택 기간 리뷰가 12건으로 직전 동일 기간 5건보다 증가했습니다.",
    );
  });

  it("pins the spike's severity and comparison to what the rules would compute", () => {
    const spikeCard = card("RECENT_REVIEW_SPIKE_CANDIDATE", "MEDIUM");

    // MEDIUM, not HIGH, and the threshold is the reason: the rules promote to HIGH only at
    // current >= 10 AND current >= previous * 3. Here 12 >= 10 holds but 12 < 15, so it
    // stays MEDIUM. Pinned because "it's a spike, so it's urgent" is the natural wrong guess.
    expect(spikeCard.severity).toBe("MEDIUM");
    // And it fires at all: current >= 5, previous >= 1, current >= previous * 2 → 12 >= 10.
    expect(spikeCard.count).toBe(12);
    expect(spikeCard.spike).toEqual({ previousCount: 5, deltaCount: 7, ratio: 12 / 5 });
  });

  it("orders signals by the backend's severity rank", () => {
    // The rules emit in gate order and then stable-sort HIGH→LOW, so the spike — emitted
    // last — outranks 신규 리뷰. The mock listed them in emission order and did not sort,
    // claiming a wire order the backend never sends.
    expect(mockAccountAttention(NAVER_ACCOUNT, WINDOW).items.map((s) => s.severity)).toEqual([
      "HIGH",
      "MEDIUM",
      "MEDIUM",
      "LOW",
    ]);
    expect(mockAccountAttention(NAVER_ACCOUNT, WINDOW).items.map((s) => s.type)).toEqual([
      "LOW_RATING_REVIEW",
      "LOW_RATING_REVIEW",
      "RECENT_REVIEW_SPIKE_CANDIDATE",
      "NEW_REVIEW",
    ]);
  });
});

/** Ratings of the rows a lens actually returns — the composition, not just the count. */
function ratings(type: string): number[] {
  return rows(type).map((i) => i.rating!);
}

const card = (type: string, severity: string) =>
  mockAccountAttention(NAVER_ACCOUNT, WINDOW).items.find((s) => s.type === type && s.severity === severity)!;

describe("every lens is derived from ONE canonical population", () => {
  it("holds 12 reviews: 2 rated 1~2, 4 rated 3, 6 rated 4~5", () => {
    // The population's split IS the fixture's contract — every count and every lens below
    // is counted from it, so this is the one place the numbers are decided.
    const all = ratings("NEW_REVIEW");
    expect(all).toHaveLength(12);
    expect(all.filter((r) => r >= 1 && r <= 2)).toHaveLength(2);
    expect(all.filter((r) => r === 3)).toHaveLength(4);
    expect(all.filter((r) => r >= 4 && r <= 5)).toHaveLength(6);
  });

  it("counts the HIGH card from the rows it stands for — exactly 2 at 1~2점", () => {
    // COMPOSITION, not just the total. The old fixture generated rows with `1 + (n % 3)`,
    // which put 4 low-rating rows behind a card claiming 2 — a card and its drill-down
    // disagreeing about the same reviews.
    expect(card("LOW_RATING_REVIEW", "HIGH").count).toBe(2);
    expect(ratings("LOW_RATING_REVIEW").filter((r) => r <= 2)).toHaveLength(2);
  });

  it("counts the MEDIUM card from the rows it stands for — exactly 4 at 3점", () => {
    expect(card("LOW_RATING_REVIEW", "MEDIUM").count).toBe(4);
    expect(ratings("LOW_RATING_REVIEW").filter((r) => r === 3)).toHaveLength(4);
  });

  it("drills LOW_RATING_REVIEW to the 1~3점 union — 6, and nothing above 3", () => {
    // AttentionItemFilters maps it to (REVIEW, 1..3), and both cards share the type, so the
    // union legitimately exceeds each card's count. That reads like a bug until you know it,
    // which is why the union is pinned as arithmetic: 2 + 4.
    const drilled = mockAttentionItems(NAVER_ACCOUNT, { type: "LOW_RATING_REVIEW", ...WINDOW }, 0, 20);

    expect(drilled.total).toBe(6);
    expect(drilled.total).toBe(card("LOW_RATING_REVIEW", "HIGH").count + card("LOW_RATING_REVIEW", "MEDIUM").count);
    expect(drilled.items).toHaveLength(6);
    expect(ratings("LOW_RATING_REVIEW").every((r) => r >= 1 && r <= 3)).toBe(true);
  });

  it.each(["NEW_REVIEW", "RECENT_REVIEW_SPIKE_CANDIDATE"])(
    "drills %s to every review in the window — 12, matching its card",
    (type) => {
      // These map to (REVIEW, no bounds), so their drill-down IS the window's review count.
      const drilled = mockAttentionItems(NAVER_ACCOUNT, { type, ...WINDOW }, 0, 20);
      const its = mockAccountAttention(NAVER_ACCOUNT, WINDOW).items.find((s) => s.type === type)!;

      expect(drilled.total).toBe(12);
      expect(drilled.total).toBe(its.count);
      expect(drilled.items).toHaveLength(12);
    },
  );

  it("keeps the lenses agreeing about the same window", () => {
    // The failure this pins: the lenses used to be generated independently, so NEW_REVIEW's
    // rows implied 6 reviews at 1~2점 while LOW_RATING's card said 2 — two views of one
    // store, one window, contradicting each other.
    const wide = ratings("NEW_REVIEW");
    expect(wide.filter((r) => r <= 2)).toHaveLength(card("LOW_RATING_REVIEW", "HIGH").count);
    expect(wide.filter((r) => r === 3)).toHaveLength(card("LOW_RATING_REVIEW", "MEDIUM").count);
    expect(wide.filter((r) => r <= 3)).toHaveLength(rows("LOW_RATING_REVIEW").length);
  });

  it("gives one review ONE address, whatever card it was found through", () => {
    // Product scope §5: a decision belongs to the review, so "어느 카드로 들어와도 같은 상태를
    // 본다". The ref used to embed the signal type, giving one review two addresses and
    // making that invariant undemonstrable — decide under 낮은 평점, re-open under 신규 리뷰,
    // see nothing.
    const viaLowRating = rows("LOW_RATING_REVIEW");
    const viaNewReview = rows("NEW_REVIEW");

    for (const low of viaLowRating) {
      const same = viaNewReview.find((r) => r.actionRef === low.actionRef);
      expect(same).toBeDefined();
      expect(same!.rating).toBe(low.rating);
      expect(same!.productName).toBe(low.productName);
    }
  });

  it("shows a decision made under one card when the review is re-opened under another", () => {
    const target = rows("LOW_RATING_REVIEW").find((r) => r.triageDisposition == null)!;
    mockVocItemTriage(target.actionRef!, "MONITOR");

    const viaOtherCard = rows("NEW_REVIEW").find((r) => r.actionRef === target.actionRef)!;
    expect(viaOtherCard.triageDisposition).toBe("MONITOR");
  });
});

describe("mockAttentionItems triage fixtures", () => {
  it("makes every review row decidable, because every row is a NAVER review", () => {
    for (const type of NAVER_SIGNALS) {
      const items = rows(type);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.sourceType).toBe("REVIEW");
        expect(item.actionRef).not.toBeNull();
      }
    }
  });

  it("sends a null reply status on every row, because an export carries none", () => {
    // Null, not "UNKNOWN": IngestedReviewVocItemSource passes null. Both render 상태 미상,
    // so the difference is invisible on screen and total on the wire — which is exactly why
    // it needs pinning rather than eyeballing. A token here is the fixture inventing a
    // column the export does not have.
    for (const type of NAVER_SIGNALS) {
      for (const item of rows(type)) {
        expect(item.replyStatus).toBeNull();
      }
    }
  });

  it("returns nothing for an inquiry lens, exactly as the NAVER source does", () => {
    // Unreachable through the UI (no inquiry card exists to click), and answered honestly
    // anyway: the real source returns an empty slice rather than listing reviews under an
    // inquiry lens. Fabricating inquiry rows here would be the fixture inventing a store.
    for (const type of INQUIRY_SIGNALS) {
      const page = mockAttentionItems(NAVER_ACCOUNT, { type, ...WINDOW }, 0, 20);
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    }
  });

  it("shows a decided row beside undecided ones", () => {
    const items = rows("LOW_RATING_REVIEW");
    // Both states visible at once, so 판단 전 is demonstrably distinct from a decision
    // rather than the only thing anyone ever sees.
    expect(items.some((i) => i.triageDisposition != null)).toBe(true);
    expect(items.some((i) => i.triageDisposition == null)).toBe(true);
  });

  it("mints synthetic refs that could never collide with a real row", () => {
    for (const item of rows("LOW_RATING_REVIEW")) {
      expect(item.actionRef).toMatch(/^review:mock-voc-/);
    }
  });
});

describe("mockVocItemTriage", () => {
  it("accepts the decision and echoes it back", () => {
    // The demo alternative was no mock at all, so every click errored — which looks more
    // broken than an absent control, and would undo the point of showing it.
    // A ref taken from the fixture, not typed in: the literal here used to be
    // `review:mock-voc-low_rating_review-0`, the old signal-type-embedded format — a live
    // counterexample to the one-review-one-address invariant this file spends five lines
    // explaining, sitting inside the file that explains it. Reading it from the rows means
    // it cannot go stale again.
    const ref = rows("LOW_RATING_REVIEW")[0].actionRef!;
    expect(mockVocItemTriage(ref, "RESPONSE_NEEDED")).toEqual({
      actionRef: ref,
      disposition: "RESPONSE_NEEDED",
      replayed: false,
    });
  });

  it("remembers the decision across a re-read, so it survives closing the drill-down", () => {
    // The failure this pins: the control seeds `recorded` once from the row, so a stateless
    // mock meant closing and re-opening the panel re-read null and the decision silently
    // evaporated — in a demo whose entire subject is a RECORD.
    const target = rows("LOW_RATING_REVIEW").find((i) => i.triageDisposition == null)!;
    expect(target.actionRef).not.toBeNull();

    mockVocItemTriage(target.actionRef!, "NO_ACTION");

    // A fresh read — exactly what re-opening the drill-down does.
    const after = rows("LOW_RATING_REVIEW").find((i) => i.actionRef === target.actionRef)!;
    expect(after.triageDisposition).toBe("NO_ACTION");
  });

  it("remembers a decision per row, not for the whole page", () => {
    const [first, second] = rows("LOW_RATING_REVIEW");
    mockVocItemTriage(first.actionRef!, "MONITOR");

    const after = rows("LOW_RATING_REVIEW");
    expect(after.find((i) => i.actionRef === first.actionRef)!.triageDisposition).toBe("MONITOR");
    expect(after.find((i) => i.actionRef === second.actionRef)!.triageDisposition).toBe(
      second.triageDisposition,
    );
  });

  it("lets a decision replace the seeded one", () => {
    const seeded = rows("LOW_RATING_REVIEW").find((i) => i.triageDisposition != null)!;
    expect(seeded.triageDisposition).toBe("RESPONSE_NEEDED");

    mockVocItemTriage(seeded.actionRef!, "NO_ACTION");

    const after = rows("LOW_RATING_REVIEW").find((i) => i.actionRef === seeded.actionRef)!;
    expect(after.triageDisposition).toBe("NO_ACTION");
  });

  it("echoes the ref it was given rather than inventing one", () => {
    // The control matches the response to its request; a mock that reshaped the ref would
    // demo a client/server contract that does not hold.
    expect(mockVocItemTriage("review:whatever", "MONITOR").actionRef).toBe("review:whatever");
  });

  it("reports every decision as freshly applied, never as a replay", () => {
    // It remembers decisions but keeps no command-id ledger, so it has no basis to say a
    // command was already applied. Claiming `replayed: true` would be the demo asserting
    // history it cannot know — including on a repeat of the same value.
    for (const d of ["RESPONSE_NEEDED", "MONITOR", "NO_ACTION"] as const) {
      const res = mockVocItemTriage("review:x", d);
      expect(res.disposition).toBe(d);
      expect(res.replayed).toBe(false);
    }
    expect(mockVocItemTriage("review:x", "MONITOR").replayed).toBe(false);
  });
});
