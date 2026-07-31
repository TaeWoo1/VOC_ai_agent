// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// The Agent page talks to the separate-origin Agent Runtime client and reads the current operator
// from auth. Mock both boundaries so the test never touches the wire; keep AgentRuntimeError REAL
// (the page's error mapping uses `instanceof`).
const agentMock = vi.hoisted(() => ({
  capabilities: vi.fn(),
  startRun: vi.fn(),
  resumeRun: vi.fn(),
  getRun: vi.fn(),
}));
vi.mock("../lib/agentRuntime/agentClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/agentRuntime/agentClient")>()),
  agentRuntime: agentMock,
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "d@e.f", name: "데모", role: "OWNER", orgId: "o1", orgName: "데모사" }, ready: true }),
}));

import { Agent } from "./Agent";
import { AgentRuntimeError } from "../lib/agentRuntime/agentClient";
import { renderWithRouter, screen, waitFor } from "../test/renderWithRouter";
import userEvent from "@testing-library/user-event";
import { api } from "../lib/apiClient";
import type { AgentRunView, CapabilitiesView } from "../lib/agentRuntime/types";

const CAPS: CapabilitiesView = {
  service: "sellerops-agent-runtime",
  version: "test",
  env: "test",
  intents: [
    { intent: "HANDLE_UNANSWERED_INQUIRIES", domain: "INQUIRY", hasCheckpoint: true, requiresAccountScope: false, examples: [] },
    { intent: "HANDLE_REVIEW_REPLIES", domain: "REVIEW", hasCheckpoint: true, requiresAccountScope: true, examples: [] },
    { intent: "HANDLE_OPERATIONS_ISSUES", domain: "ISSUE", hasCheckpoint: false, requiresAccountScope: false, examples: [] },
  ],
  runStore: { kind: "file", durable: true, multiInstanceSafe: false },
  externalSend: "disabled",
};

const INQUIRY_AWAITING: AgentRunView = {
  threadId: "t-inq",
  domain: "INQUIRY",
  status: "AWAITING_APPROVAL",
  trail: ["searched", "prioritized", "drafted", "awaiting_approval"],
  checkpoint: {
    kind: "INQUIRY_REPLY_APPROVAL",
    domain: "INQUIRY",
    workItemId: "wi-1",
    inquiryId: "iq-1",
    phase: "OPEN",
    priorityBucket: "HIGH",
    category: "exchange_return_reply",
    provenance: { providerKind: "RULE_BASED", name: "rule-drafter", version: "rules-v1" },
    replyDraft: "안녕하세요, 문의해 주셔서 감사합니다.",
  },
};

const INQUIRY_DONE: AgentRunView = {
  threadId: "t-inq",
  domain: "INQUIRY",
  status: "DONE",
  trail: ["...", "recorded_approved"],
  outcome: {
    recorded: true,
    decision: "APPROVED",
    workItemId: "wi-1",
    phase: "ACTION_PENDING",
    executionStatus: "ACTION_PENDING",
    category: "PENDING",
    approvedFingerprint: "abc123",
    externalSendAttempted: false,
  },
};

const ISSUE_DONE: AgentRunView = {
  threadId: "t-iss",
  domain: "ISSUE",
  status: "DONE",
  trail: ["searched", "prioritized", "assembled", "composed"],
  brief: {
    referenceDate: "2026-07-25",
    totalActiveIssues: 4,
    selectedCount: 1,
    entries: [
      {
        issueId: "is-1",
        rank: 1,
        priorityBucket: "HIGH",
        title: "포장 파손",
        aspect: "포장",
        problem: "파손",
        severity: "HIGH",
        lifecycleState: "ACTIVE",
        lifecycleLabelKo: "진행 중",
        evidenceCount: 7,
        firstEvidenceOn: "2026-07-01",
        lastEvidenceOn: "2026-07-24",
        dominantProductId: "p-1",
        dominantProductName: "몰딩 화이트",
        trend: { kinds: ["CONCENTRATED"], labelsKo: ["집중"], highSurge: false, surgeWindowCount: 3, surgeBaselineWeekly: 1 },
        evidenceSummary: {
          totalEvidence: 7,
          byProduct: [{ productId: "p-1", productName: "몰딩 화이트", evidenceCount: 7 }],
          unattributedEvidence: 0,
          ratingDistribution: { rating1: 3, rating2: 4, rating3: 0, rating4: 0, rating5: 0, unrated: 0 },
        },
        lifecycleHistoryDepth: 1,
      },
    ],
  },
};

const DRAFT_PREPARED: AgentRunView = {
  threadId: "t-draft",
  domain: "INQUIRY_DRAFT",
  status: "DONE",
  trail: ["searched", "prioritized", "detailed", "drafted"],
  draftPreparation: {
    kind: "INQUIRY_DRAFT_PREPARATION",
    domain: "INQUIRY_DRAFT",
    prepared: true,
    workItemId: "wi-c",
    inquiryId: "iq-c",
    phase: "OPEN",
    priorityBucket: "HIGH",
    category: "delivery_status_reply",
    provenance: { providerKind: "RULE_BASED", name: "rule-drafter", version: "rules-v1" },
    channelId: "chan-cafe24",
    channelCode: "CAFE24",
    channelNameKo: "카페24",
    inquiryStatus: "UNANSWERED",
    informStatus: "N",
    isSecret: true,
    generatedAt: "2026-07-31T00:00:00.000Z",
    replyDraft: "안녕하세요, 문의해 주셔서 감사합니다. 배송 진행 상황을 확인하여 빠르게 안내드리겠습니다.",
  },
};

describe("운영 에이전트 page", () => {
  beforeEach(() => {
    agentMock.capabilities.mockResolvedValue(CAPS);
    agentMock.startRun.mockReset();
    agentMock.resumeRun.mockReset();
    vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([]);
  });

  it("renders the command form and the fail-closed capability badge", async () => {
    renderWithRouter(<Agent />);
    expect(screen.getByRole("form", { name: "에이전트 명령 입력" })).toBeInTheDocument();
    expect(await screen.findByText(/외부 발송 없음/)).toBeInTheDocument();
  });

  it("inquiry: shows the templated reply + approve/reject and a link to 문의 응답 (no raw 원문 here)", async () => {
    agentMock.startRun.mockResolvedValue(INQUIRY_AWAITING);
    renderWithRouter(<Agent />);
    await userEvent.type(screen.getByLabelText("명령"), "미답변 문의 처리해줘");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));

    const group = await screen.findByRole("group", { name: "문의 답변 승인" });
    expect(group).toBeInTheDocument();
    expect((screen.getByLabelText("답변 초안") as HTMLTextAreaElement).value).toContain("안녕하세요");
    // The authorized detail screen is linked for the raw customer 원문.
    expect(screen.getByRole("link", { name: "문의 응답" })).toHaveAttribute("href", "/inquiries");
    expect(agentMock.startRun).toHaveBeenCalledWith(expect.objectContaining({ goalText: "미답변 문의 처리해줘" }));
  });

  it("inquiry: approve calls resumeRun and shows the recorded, no-send outcome", async () => {
    agentMock.startRun.mockResolvedValue(INQUIRY_AWAITING);
    agentMock.resumeRun.mockResolvedValue(INQUIRY_DONE);
    renderWithRouter(<Agent />);
    await userEvent.type(screen.getByLabelText("명령"), "미답변 문의");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    await screen.findByRole("group", { name: "문의 답변 승인" });
    await userEvent.click(screen.getByRole("button", { name: "승인 (기록)" }));

    await waitFor(() =>
      expect(agentMock.resumeRun).toHaveBeenCalledWith("t-inq", expect.objectContaining({ approved: true, approvedBy: "SELLER:u1" })),
    );
    expect(await screen.findByText("승인 기록됨")).toBeInTheDocument();
    expect(screen.getByText(/외부로 발송된 내용은 없습니다/)).toBeInTheDocument();
  });

  it("issue: renders the quote-free brief with a link to 상품 이슈", async () => {
    agentMock.startRun.mockResolvedValue(ISSUE_DONE);
    renderWithRouter(<Agent />);
    await userEvent.type(screen.getByLabelText("명령"), "지금 먼저 확인할 운영 이슈는 뭐야");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));

    expect(await screen.findByRole("group", { name: "운영 이슈 브리핑" })).toBeInTheDocument();
    expect(screen.getByText("포장 파손")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "상품 이슈" })).toHaveAttribute("href", "/issues");
  });

  it("re-seeds the inquiry draft when a new AWAITING run replaces an unapproved one (no stale carry-over)", async () => {
    const runA = INQUIRY_AWAITING; // thread t-inq, draft "안녕하세요, 문의해 주셔서 감사합니다."
    const runB: AgentRunView = {
      ...INQUIRY_AWAITING,
      threadId: "t-inq-2",
      checkpoint: { ...INQUIRY_AWAITING.checkpoint!, replyDraft: "다른 초안 내용입니다." } as typeof INQUIRY_AWAITING.checkpoint,
    };
    agentMock.startRun.mockResolvedValueOnce(runA).mockResolvedValueOnce(runB);
    renderWithRouter(<Agent />);
    await userEvent.type(screen.getByLabelText("명령"), "미답변 문의");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    const editor = (await screen.findByLabelText("답변 초안")) as HTMLTextAreaElement;
    // Operator edits run A's draft but does NOT approve.
    await userEvent.clear(editor);
    await userEvent.type(editor, "운영자가 A를 수정함");
    // A second command produces a different AWAITING inquiry run.
    await userEvent.type(screen.getByLabelText("명령"), " 다시");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    // The editor must show run B's fresh draft, not the stale edit from run A.
    const editor2 = (await screen.findByLabelText("답변 초안")) as HTMLTextAreaElement;
    expect(editor2.value).toBe("다른 초안 내용입니다.");
    expect(editor2.value).not.toContain("운영자가 A를 수정함");
  });

  it("draft: 초안 생성 shows the draft + channel/status/secret and the not-sent line, with no send/approve control", async () => {
    agentMock.startRun.mockResolvedValue(DRAFT_PREPARED);
    renderWithRouter(<Agent />);
    await userEvent.click(await screen.findByRole("button", { name: "초안 생성" }));

    const group = await screen.findByRole("group", { name: "문의 답변 초안" });
    expect(group).toBeInTheDocument();
    expect((screen.getByLabelText("답변 초안") as HTMLTextAreaElement).value).toContain("안녕하세요");
    // Metadata: target channel, inquiry status, secret flag, rule-based provenance.
    expect(screen.getByText("카페24")).toBeInTheDocument();
    expect(screen.getByText("미답변")).toBeInTheDocument();
    expect(screen.getByText("비밀글")).toBeInTheDocument();
    expect(screen.getByText(/규칙 기반 · rule-drafter/)).toBeInTheDocument();
    // The explicit not-sent status line for the target channel.
    expect(screen.getByText(/초안만 생성되었습니다\. 카페24에는 아직 전송되지 않았습니다\./)).toBeInTheDocument();
    // NO send/전송/발송 control and NO approve/reject — this run already finished at the checkpoint.
    expect(screen.queryByRole("button", { name: /전송|발송|등록|Cafe24로/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "승인 (기록)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "거절" })).toBeNull();
    // The regenerate CTA is present and the launch used the draft intent.
    expect(screen.getByRole("button", { name: "초안 다시 만들기" })).toBeInTheDocument();
    expect(agentMock.startRun).toHaveBeenCalledWith(expect.objectContaining({ intent: "PREPARE_INQUIRY_DRAFT" }));
  });

  it("draft: 초안 다시 만들기 warns before overwriting a locally edited draft, then regenerates on 계속", async () => {
    agentMock.startRun.mockResolvedValue(DRAFT_PREPARED);
    renderWithRouter(<Agent />);
    await userEvent.click(await screen.findByRole("button", { name: "초안 생성" }));
    const editor = (await screen.findByLabelText("답변 초안")) as HTMLTextAreaElement;
    await userEvent.type(editor, " 추가 편집");

    // First click surfaces the overwrite warning — it does NOT regenerate yet.
    await userEvent.click(screen.getByRole("button", { name: "초안 다시 만들기" }));
    expect(screen.getByRole("alert")).toHaveTextContent("편집한 초안이 사라집니다");
    expect(agentMock.startRun).toHaveBeenCalledTimes(1);

    // Confirming regenerates (a fresh draft run).
    await userEvent.click(screen.getByRole("button", { name: "계속" }));
    await waitFor(() => expect(agentMock.startRun).toHaveBeenCalledTimes(2));
  });

  it("draft: reports nothing to draft when the queue is empty", async () => {
    agentMock.startRun.mockResolvedValue({
      threadId: "t-draft-empty",
      domain: "INQUIRY_DRAFT",
      status: "DONE",
      trail: ["searched", "prioritized_empty"],
      draftPreparation: {
        kind: "INQUIRY_DRAFT_PREPARATION",
        domain: "INQUIRY_DRAFT",
        prepared: false,
        workItemId: null,
        inquiryId: null,
        phase: null,
        priorityBucket: null,
        category: null,
        provenance: null,
        channelId: null,
        channelCode: null,
        channelNameKo: null,
        inquiryStatus: null,
        informStatus: null,
        isSecret: null,
        generatedAt: null,
        note: "no unanswered inquiries to draft",
      },
    });
    renderWithRouter(<Agent />);
    await userEvent.click(await screen.findByRole("button", { name: "초안 생성" }));
    expect(await screen.findByText("지금 초안을 만들 미답변 문의가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByLabelText("답변 초안")).toBeNull();
  });

  it("surfaces a missing-account-scope error with a helpful hint", async () => {
    agentMock.startRun.mockRejectedValue(new AgentRuntimeError(400, "MISSING_ACCOUNT_SCOPE"));
    renderWithRouter(<Agent />);
    await userEvent.type(screen.getByLabelText("명령"), "리뷰 답변 준비해줘");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("판매 계정을 선택");
  });
});
