import type { UploadType } from "./types";

// Sample CSVs — MUST stay byte-identical to docs/sample_uploads/*.csv. They are
// duplicated here (not imported) because the frontend Docker build context is
// `frontend/` only and cannot reach docs/. They intentionally exercise the demo
// flows: external-id dedup, content-hash dedup (no-id rows), and one invalid
// (empty-body) inquiry row → PARTIAL. Re-uploading review/order → all skipped, SUCCESS.
export const SAMPLE_CSV: Record<UploadType, string> = {
  REVIEW: [
    "상품명,평점,내용,작성일,리뷰id",
    "전선몰딩 1호,5,설치가 쉬워서 좋았어요,2026-06-01,RV-1001",
    "전선몰딩 1호,2,접착력이 약해 금방 떨어졌어요,2026-06-02,RV-1002",
    "전선몰딩 1호,5,설치가 쉬워서 좋았어요,2026-06-01,RV-1001",
    "코너 마감 몰딩,4,색상이 사진과 비슷해서 만족합니다,2026-06-03,",
    "코너 마감 몰딩,4,색상이 사진과 비슷해서 만족합니다,2026-06-03,",
  ].join("\n") + "\n",
  INQUIRY: [
    "상품명,작성자,문의내용,상태,작성일,문의id",
    "전선몰딩 1호,구매자1,곡면 벽에도 시공 가능한가요?,미답변,2026-06-05,Q-2001",
    "코너 마감 몰딩,구매자2,추가 양면테이프가 필요한가요?,답변완료,2026-06-06,Q-2002",
    "전선몰딩 1호,구매자1,곡면 벽에도 시공 가능한가요?,미답변,2026-06-05,Q-2001",
    "전선몰딩 1호,구매자3,,미답변,2026-06-07,Q-2003",
  ].join("\n") + "\n",
  ORDER_SUMMARY: [
    "날짜,주문수,매출액",
    "2026-06-11,42,567000",
    "2026-06-10,38,513000",
    "2026-06-09,30,405000",
  ].join("\n") + "\n",
};

// Required vs optional columns, shown as helper text under the type selector.
export const COLUMN_HELP: Record<UploadType, { required: string; optional: string }> = {
  REVIEW: {
    required: "내용",
    optional: "상품명(또는 sku), 평점, 작성일, 리뷰id",
  },
  INQUIRY: {
    required: "문의내용",
    optional: "상품명(또는 sku), 작성자, 상태(미답변/답변완료), 작성일, 문의id",
  },
  ORDER_SUMMARY: {
    required: "날짜",
    optional: "주문수, 매출액",
  },
};

export const SAMPLE_FILENAME: Record<UploadType, string> = {
  REVIEW: "review_sample.csv",
  INQUIRY: "inquiry_sample.csv",
  ORDER_SUMMARY: "order_summary_sample.csv",
};

export function downloadCsv(uploadType: UploadType): void {
  // Prepend a UTF-8 BOM so Korean headers open correctly in Excel on Windows.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + SAMPLE_CSV[uploadType]], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = SAMPLE_FILENAME[uploadType];
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
