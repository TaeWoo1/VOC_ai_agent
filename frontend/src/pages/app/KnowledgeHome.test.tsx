// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { KnowledgeHome } from "./KnowledgeHome";
import type {
  KnowledgeCandidateView,
  KnowledgeDocumentView,
  KnowledgeSummaryView,
} from "../../lib/types";

const getKnowledgeDocuments = vi.fn();
const getKnowledgeCandidates = vi.fn();
const getKnowledgeSummary = vi.fn();
const proposeKnowledgeCandidates = vi.fn();
const acceptKnowledgeCandidate = vi.fn();
const dismissKnowledgeCandidate = vi.fn();
const setKnowledgeDocumentActive = vi.fn();
const importKnowledgeDocument = vi.fn();
const getProductKnowledgeStrict = vi.fn();
vi.mock("../../lib/apiClient", () => ({
  api: {
    getKnowledgeDocuments: (...a: unknown[]) => getKnowledgeDocuments(...a),
    getKnowledgeCandidates: (...a: unknown[]) => getKnowledgeCandidates(...a),
    getKnowledgeSummary: (...a: unknown[]) => getKnowledgeSummary(...a),
    proposeKnowledgeCandidates: (...a: unknown[]) => proposeKnowledgeCandidates(...a),
    acceptKnowledgeCandidate: (...a: unknown[]) => acceptKnowledgeCandidate(...a),
    dismissKnowledgeCandidate: (...a: unknown[]) => dismissKnowledgeCandidate(...a),
    setKnowledgeDocumentActive: (...a: unknown[]) => setKnowledgeDocumentActive(...a),
    importKnowledgeDocument: (...a: unknown[]) => importKnowledgeDocument(...a),
    getProductKnowledgeStrict: (...a: unknown[]) => getProductKnowledgeStrict(...a),
  },
  getToken: () => null,
}));

const CANDIDATE: KnowledgeCandidateView = {
  id: "c-1",
  scope: "ORG",
  productId: null,
  productName: null,
  subject: "부착 전 표면의 먼지와 기름기를 제거해 주세요.",
  content: "부착 전 표면의 먼지와 기름기를 제거해 주세요.",
  origin: "REPEATED_ANSWER",
  evidenceCount: 18,
  state: "OPEN",
  sourceId: null,
  createdAt: "2026-09-03T00:00:00Z",
};

/** A drafting gap: its stored text is the QUESTION, and that is the whole point of this suite. */
const GAP: KnowledgeCandidateView = {
  id: "c-2",
  scope: "PRODUCT",
  productId: "p-1",
  productName: "실리콘 주방매트",
  subject: "미끄럼 방지",
  content: "「미끄럼 방지」에 대해 고객에게 안내할 공식 기준이 필요합니다.",
  origin: "DRAFT_GAP",
  evidenceCount: 0,
  state: "OPEN",
  sourceId: null,
  createdAt: "2026-09-03T00:00:00Z",
};

const DOCUMENT: KnowledgeDocumentView = {
  sourceId: "s-1",
  scope: "ORG",
  productId: null,
  productName: null,
  fileName: "제품 사용설명서.pdf",
  title: "제품 사용설명서",
  kind: "GENERAL_CS_FAQ",
  active: true,
  passages: 12,
  uploadedBy: "demo",
  uploadedAt: "2026-09-03T00:00:00Z",
};

const SUMMARY: KnowledgeSummaryView = {
  productKnowledge: 38,
  operatingRules: 6,
  documents: 4,
  pastAnswers: 23,
  products: 142,
  needsConfirmation: 1,
};

beforeEach(() => {
  getKnowledgeDocuments.mockReset().mockResolvedValue([DOCUMENT]);
  getKnowledgeCandidates.mockReset().mockResolvedValue([CANDIDATE]);
  getKnowledgeSummary.mockReset().mockResolvedValue(SUMMARY);
  proposeKnowledgeCandidates.mockReset().mockResolvedValue([CANDIDATE]);
  acceptKnowledgeCandidate.mockReset().mockResolvedValue({ ...CANDIDATE, state: "ACCEPTED" });
  dismissKnowledgeCandidate.mockReset().mockResolvedValue({ ...CANDIDATE, state: "DISMISSED" });
  setKnowledgeDocumentActive.mockReset().mockResolvedValue({ ...DOCUMENT, active: false });
  importKnowledgeDocument.mockReset().mockResolvedValue(DOCUMENT);
  getProductKnowledgeStrict.mockReset().mockResolvedValue({ variants: [] });
});

function draw() {
  render(<MemoryRouter><KnowledgeHome /></MemoryRouter>);
}

describe("reviewnary가 알고 있는 정보", () => {
  it("keeps its own title — it says what it knows, not only what was handed over", async () => {
    draw();
    const summary = await screen.findByTestId("knowledge-summary");
    for (const [label, value] of [
      ["상품 지식", "38"],
      ["운영 기준", "6"],
      ["연결된 자료", "4"],
      ["과거 고객 응답", "23"],
    ]) {
      expect(summary).toHaveTextContent(label);
      expect(summary).toHaveTextContent(value);
    }
    // What reviewnary read WITHOUT being taught — the answer to 「처음부터 다 입력해야 하나요」.
    expect(screen.getByText(/상품 정보 142개를 이미 읽고 있습니다/)).toBeInTheDocument();
    // Past answers are consulted, never official, and the screen says so in words.
    expect(screen.getByText(/공식 기준으로는 쓰지 않습니다/)).toBeInTheDocument();
  });

  it("shows what was noticed with the seller's own count, and never promotes it", async () => {
    draw();
    const candidates = await screen.findByTestId("knowledge-inbox-candidates");
    expect(candidates).toHaveTextContent("부착 전 표면의 먼지와 기름기를 제거해 주세요.");
    // The fact that makes it worth a glance is a COUNT of the seller's own answers — not a score.
    expect(candidates).toHaveTextContent("과거 답변 18건에서 반복");
    expect(screen.getByText("확인할 후보")).toBeInTheDocument();
    // Nothing was written by rendering it.
    expect(acceptKnowledgeCandidate).not.toHaveBeenCalled();
  });

  it("the seller's press is what turns a candidate into knowledge, and it writes what they wrote", async () => {
    draw();
    await screen.findByTestId("knowledge-inbox-candidates");
    getKnowledgeCandidates.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: "답변 기준으로 등록" }));
    // A repeated sentence is the SELLER's own, so the editor opens holding it.
    expect(await screen.findByTestId("knowledge-quick-add")).toBeInTheDocument();
    expect((screen.getByLabelText("고객에게 안내할 내용") as HTMLTextAreaElement).value)
      .toBe("부착 전 표면의 먼지와 기름기를 제거해 주세요.");
    await userEvent.click(screen.getByRole("button", { name: "답변 기준으로 등록" }));
    await waitFor(() =>
      expect(acceptKnowledgeCandidate).toHaveBeenCalledWith("c-1", {
        title: "부착 전 표면의 먼지와 기름기를 제거해 주세요.",
        content: "부착 전 표면의 먼지와 기름기를 제거해 주세요.",
        orgType: "SHIPPING_POLICY",
      }),
    );
  });

  it("a drafting gap is a QUESTION — the editor opens empty and the question is never saved as an answer", async () => {
    getKnowledgeCandidates.mockResolvedValue([GAP]);
    draw();
    const gaps = await screen.findByTestId("knowledge-inbox-gaps");
    expect(gaps).toHaveTextContent("「미끄럼 방지」에 대해 고객에게 안내할 공식 기준이 필요합니다.");
    expect(screen.getByText("정보 필요")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "답변 기준 추가" }));
    const body = (await screen.findByLabelText("고객에게 안내할 내용")) as HTMLTextAreaElement;
    // EMPTY. Accepting a gap unedited used to file the question itself as the company's knowledge.
    expect(body.value).toBe("");
    // And with nothing written there is nothing to save.
    expect(screen.getByRole("button", { name: "답변 기준으로 등록" })).toBeDisabled();

    await userEvent.type(body, "실리콘 매트는 물기를 닦은 평평한 바닥에서 밀리지 않습니다.");
    await userEvent.click(screen.getByRole("button", { name: "답변 기준으로 등록" }));
    await waitFor(() =>
      expect(acceptKnowledgeCandidate).toHaveBeenCalledWith("c-2", expect.objectContaining({
        content: "실리콘 매트는 물기를 닦은 평평한 바닥에서 밀리지 않습니다.",
      })),
    );
  });

  it("「아니요」 dismisses without writing anything", async () => {
    draw();
    await screen.findByTestId("knowledge-inbox-candidates");
    getKnowledgeCandidates.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: "아니요" }));
    await waitFor(() => expect(dismissKnowledgeCandidate).toHaveBeenCalledWith("c-1"));
    expect(acceptKnowledgeCandidate).not.toHaveBeenCalled();
  });

  it("a document says what it is, where it applies, when it came and who brought it — no internal vocabulary", async () => {
    draw();
    const documents = await screen.findByTestId("knowledge-documents");
    expect(documents).toHaveTextContent("제품 사용설명서.pdf");
    expect(documents).toHaveTextContent("공통 안내");
    expect(documents).toHaveTextContent("회사 전체");
    expect(documents).toHaveTextContent("2026-09-03");
    expect(documents).toHaveTextContent("demo");
    // The seller's screen never says chunk, embedding, source id, score — or a stored constant.
    for (const word of ["chunk", "embedding", "sourceId", "score", "s-1", "GENERAL_CS_FAQ"]) {
      expect(document.body.textContent).not.toContain(word);
    }
  });

  it("a document that produced nothing says so, and 확인 필요 offers the way out", async () => {
    getKnowledgeDocuments.mockResolvedValue([{ ...DOCUMENT, passages: 0 }]);
    getKnowledgeCandidates.mockResolvedValue([]);
    draw();
    const problems = await screen.findByTestId("knowledge-inbox-documents");
    expect(problems).toHaveTextContent("읽을 내용 없음");
    expect(screen.getByText("자료 문제")).toBeInTheDocument();
  });

  it("retiring is offered as retiring — the row stays and the wording says so", async () => {
    draw();
    await screen.findByTestId("knowledge-documents");
    await userEvent.click(screen.getByRole("button", { name: "사용 중지" }));
    await waitFor(() => expect(setKnowledgeDocumentActive).toHaveBeenCalledWith("s-1", false));
    // Never 삭제: the citations that stood on it must keep resolving.
    expect(document.body.textContent).not.toContain("삭제");
  });

  it("proposing looks through past answers and reports what it found", async () => {
    getKnowledgeCandidates.mockResolvedValue([]);
    proposeKnowledgeCandidates.mockResolvedValue([]);
    draw();
    await screen.findByText("지금 확인하실 항목은 없습니다.");
    await userEvent.click(screen.getByRole("button", { name: "과거 답변에서 찾아보기" }));
    expect(await screen.findByText("과거 답변에서 반복되는 문장을 찾지 못했습니다.")).toBeInTheDocument();
  });

  it("a company that has written nothing is told what has already been read, not that it is empty", async () => {
    getKnowledgeCandidates.mockResolvedValue([]);
    getKnowledgeDocuments.mockResolvedValue([]);
    getKnowledgeSummary.mockResolvedValue({
      productKnowledge: 0, operatingRules: 0, documents: 0, pastAnswers: 0, products: 142,
      needsConfirmation: 0,
    });
    draw();
    expect(await screen.findByText(/상품 정보 142개를 이미 읽고 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/이미 쓰고 계신 것부터 올려 주세요/)).toBeInTheDocument();
  });

  it("a first day says what has not been read yet, and offers no control that can only find nothing", async () => {
    getKnowledgeCandidates.mockResolvedValue([]);
    getKnowledgeDocuments.mockResolvedValue([]);
    getKnowledgeSummary.mockResolvedValue({
      productKnowledge: 0, operatingRules: 0, documents: 0, pastAnswers: 0, products: 0,
      needsConfirmation: 0,
    });
    draw();
    expect(await screen.findByText(/채널에서 가져온 정보가 아직 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "채널 연결" })).toHaveAttribute("href", "/connect");
    // With no past answers, looking through them can only report that there were none.
    expect(screen.queryByRole("button", { name: "과거 답변에서 찾아보기" })).toBeNull();
  });

  it("the upload asks what the file is, and the refusal is the backend's own sentence", async () => {
    importKnowledgeDocument.mockImplementation(() =>
      new Promise((_r, reject) =>
        setTimeout(() => reject({
          isAxiosError: true,
          response: { status: 400, data: { message: "이 형식은 읽을 수 없습니다. PDF · DOCX · TXT · MD · CSV 파일을 읽을 수 있습니다." } },
        }), 0)),
    );
    draw();
    await screen.findByTestId("knowledge-documents");
    await userEvent.click(screen.getByRole("button", { name: "자료 추가" }));
    // The one question the file cannot answer, asked once — never a review of its passages.
    expect(await screen.findByLabelText("어떤 자료인가요")).toBeInTheDocument();
    // The input is visually hidden behind its own button, so the change is fired directly rather
    // than through a pointer interaction userEvent would refuse on a display:none element.
    const input = screen.getByLabelText("자료 파일") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "manual.hwp")] } });
    expect(await screen.findByText(/이 형식은 읽을 수 없습니다/)).toBeInTheDocument();
  });
});
