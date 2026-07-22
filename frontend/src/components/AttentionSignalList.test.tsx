// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AttentionSignalList } from "./AttentionSignalList";
import { api } from "../lib/apiClient";
import type { AttentionSignal, OperatorAttentionSummary } from "../lib/types";

// The review-ops headline: the minimal honest number an operator sees after an acquisition run.
// It is derived from the attention summary the backend already serves — no new endpoint, no new
// field — and it must never appear on a failed or empty read, where "0건" would read as
// reassurance the data does not support.

function signal(over: Partial<AttentionSignal> = {}): AttentionSignal {
  return {
    type: "LOW_RATING_REVIEW",
    severity: "HIGH",
    count: 2,
    label: "낮은 평점 리뷰",
    description: "",
    sourceType: "REVIEW",
    channel: "네이버 스마트스토어",
    ...over,
  };
}

function summary(items: AttentionSignal[]): OperatorAttentionSummary {
  return {
    sellerAccountId: "acct-42",
    channel: "네이버 스마트스토어",
    fromDate: "2026-05-01",
    toDate: "2026-05-31",
    items,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("AttentionSignalList — review-ops headline", () => {
  it("shows how many reviews need a look, counting neither arrivals nor inquiries", async () => {
    // The spine's own shape: ratings 1·2·3·4·5·5 → HIGH 2 + MEDIUM 1 need a look; the six that
    // merely arrived (NEW_REVIEW) do not, and an unanswered inquiry is a different queue.
    vi.spyOn(api, "getAccountAttention").mockResolvedValue(
      summary([
        signal({ severity: "HIGH", count: 2 }),
        signal({ severity: "MEDIUM", count: 1 }),
        signal({ type: "NEW_REVIEW", severity: "LOW", count: 6 }),
        signal({ type: "UNANSWERED_INQUIRY", severity: "HIGH", count: 9, sourceType: "INQUIRY" }),
      ]),
    );

    render(<AttentionSignalList accountId="acct-42" />);

    expect(await screen.findByTestId("reviews-needing-attention")).toHaveTextContent(
      "현재 확인이 필요한 리뷰 3건",
    );
  });

  it("renders the number the spine contract declares", async () => {
    // The render-side half of the three-port joint: the backend asserts its service produces these
    // signals, the collector E2E asserts the live API payload matches them, and this asserts what an
    // operator ends up reading. Same declaration, verified per stack, no cross-stack imports.
    const contract = JSON.parse(
      readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), "../../../contracts/review-export/naver/v1/expected-rows.json"),
        "utf8",
      ),
    ) as {
      expectedAttention: {
        signals: Array<{ type: string; severity: string; count: number; sourceType: string }>;
        reviewsNeedingAttention: number;
      };
    };
    vi.spyOn(api, "getAccountAttention").mockResolvedValue(
      summary(contract.expectedAttention.signals.map((s) => signal(s))),
    );

    render(<AttentionSignalList accountId="acct-42" />);

    expect(await screen.findByTestId("reviews-needing-attention")).toHaveTextContent(
      `현재 확인이 필요한 리뷰 ${contract.expectedAttention.reviewsNeedingAttention}건`,
    );
  });

  it("stays silent when nothing needs a look — no 0건 line", async () => {
    vi.spyOn(api, "getAccountAttention").mockResolvedValue(
      summary([signal({ type: "NEW_REVIEW", severity: "LOW", count: 6 })]),
    );

    render(<AttentionSignalList accountId="acct-42" />);

    // The list still renders the arrival signal; only the headline is withheld.
    await screen.findByText(/낮은 평점 리뷰|새 리뷰|NEW_REVIEW/);
    expect(screen.queryByTestId("reviews-needing-attention")).not.toBeInTheDocument();
  });

  it("shows no headline when the read fails — a dead backend never reads as calm", async () => {
    vi.spyOn(api, "getAccountAttention").mockRejectedValue(new Error("backend down"));

    render(<AttentionSignalList accountId="acct-42" />);

    await waitFor(() =>
      expect(screen.getByText(/확인할 일을 불러오지 못했습니다/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("reviews-needing-attention")).not.toBeInTheDocument();
  });
});
