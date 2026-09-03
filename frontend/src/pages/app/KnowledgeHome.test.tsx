// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { KnowledgeHome } from "./KnowledgeHome";
import type { KnowledgeCandidateView, KnowledgeDocumentView } from "../../lib/types";

const getKnowledgeDocuments = vi.fn();
const getKnowledgeCandidates = vi.fn();
const proposeKnowledgeCandidates = vi.fn();
const acceptKnowledgeCandidate = vi.fn();
const dismissKnowledgeCandidate = vi.fn();
const setKnowledgeDocumentActive = vi.fn();
const importKnowledgeDocument = vi.fn();
vi.mock("../../lib/apiClient", () => ({
  api: {
    getKnowledgeDocuments: (...a: unknown[]) => getKnowledgeDocuments(...a),
    getKnowledgeCandidates: (...a: unknown[]) => getKnowledgeCandidates(...a),
    proposeKnowledgeCandidates: (...a: unknown[]) => proposeKnowledgeCandidates(...a),
    acceptKnowledgeCandidate: (...a: unknown[]) => acceptKnowledgeCandidate(...a),
    dismissKnowledgeCandidate: (...a: unknown[]) => dismissKnowledgeCandidate(...a),
    setKnowledgeDocumentActive: (...a: unknown[]) => setKnowledgeDocumentActive(...a),
    importKnowledgeDocument: (...a: unknown[]) => importKnowledgeDocument(...a),
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

beforeEach(() => {
  getKnowledgeDocuments.mockReset().mockResolvedValue([DOCUMENT]);
  getKnowledgeCandidates.mockReset().mockResolvedValue([CANDIDATE]);
  proposeKnowledgeCandidates.mockReset().mockResolvedValue([CANDIDATE]);
  acceptKnowledgeCandidate.mockReset().mockResolvedValue({ ...CANDIDATE, state: "ACCEPTED" });
  dismissKnowledgeCandidate.mockReset().mockResolvedValue({ ...CANDIDATE, state: "DISMISSED" });
  setKnowledgeDocumentActive.mockReset().mockResolvedValue({ ...DOCUMENT, active: false });
});

function draw() {
  render(<MemoryRouter><KnowledgeHome /></MemoryRouter>);
}

describe("reviewnary가 알고 있는 정보", () => {
  it("shows what was noticed with the seller's own count, and never promotes it", async () => {
    draw();
    const candidates = await screen.findByTestId("knowledge-candidates");
    expect(candidates).toHaveTextContent("부착 전 표면의 먼지와 기름기를 제거해 주세요.");
    // The fact that makes it worth a glance is a COUNT of the seller's own answers — not a score.
    expect(candidates).toHaveTextContent("과거 답변 18건에서 반복");
    expect(candidates).toHaveTextContent("반복된 답변");
    // Nothing was written by rendering it.
    expect(acceptKnowledgeCandidate).not.toHaveBeenCalled();
  });

  it("the seller's press is what turns a candidate into knowledge", async () => {
    draw();
    await screen.findByTestId("knowledge-candidates");
    getKnowledgeCandidates.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: "답변 기준으로 등록" }));
    await waitFor(() => expect(acceptKnowledgeCandidate).toHaveBeenCalledWith("c-1", {}));
    expect(await screen.findByText("답변 기준으로 등록했습니다.")).toBeInTheDocument();
  });

  it("「아니요」 dismisses without writing anything", async () => {
    draw();
    await screen.findByTestId("knowledge-candidates");
    getKnowledgeCandidates.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: "아니요" }));
    await waitFor(() => expect(dismissKnowledgeCandidate).toHaveBeenCalledWith("c-1"));
    expect(acceptKnowledgeCandidate).not.toHaveBeenCalled();
  });

  it("a document is named by its file, its scope and whether it is current — no internal vocabulary", async () => {
    draw();
    const documents = await screen.findByTestId("knowledge-documents");
    expect(documents).toHaveTextContent("제품 사용설명서.pdf");
    expect(documents).toHaveTextContent("회사 전체");
    expect(documents).toHaveTextContent("12개 문단");
    // The seller's screen never says chunk, embedding, source id or score.
    for (const word of ["chunk", "embedding", "sourceId", "score", "s-1"]) {
      expect(document.body.textContent).not.toContain(word);
    }
  });

  it("a document that produced nothing says so rather than looking normal", async () => {
    getKnowledgeDocuments.mockResolvedValue([{ ...DOCUMENT, passages: 0 }]);
    draw();
    expect(await screen.findByText("읽을 내용 없음")).toBeInTheDocument();
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

  it("the upload refusal is the backend's own sentence — it says which of the four happened", async () => {
    importKnowledgeDocument.mockImplementation(() =>
      new Promise((_r, reject) =>
        setTimeout(() => reject({
          isAxiosError: true,
          response: { status: 400, data: { message: "이 형식은 읽을 수 없습니다. PDF · DOCX · TXT · MD · CSV 파일을 읽을 수 있습니다." } },
        }), 0)),
    );
    draw();
    await screen.findByTestId("knowledge-documents");
    // The input is visually hidden behind its own button, so the change is fired directly rather
    // than through a pointer interaction userEvent would refuse on a display:none element.
    const input = screen.getByLabelText("자료 파일") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "manual.hwp")] } });
    expect(await screen.findByText(/이 형식은 읽을 수 없습니다/)).toBeInTheDocument();
  });
});
