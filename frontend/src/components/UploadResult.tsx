import { Link } from "react-router-dom";
import type { IngestResult } from "../lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  SUCCESS: { label: "성공", cls: "bg-good/10 text-good" },
  PARTIAL: { label: "일부 성공", cls: "bg-warn/10 text-warn" },
  FAILED: { label: "실패", cls: "bg-bad/10 text-bad" },
};

export function UploadResult({ result }: { result: IngestResult }) {
  const status = STATUS[result.status] ?? STATUS.FAILED;
  // 주문·매출 has no inbox surface, so its primary CTA is the Orders dashboard;
  // 문의/리뷰 land on the inbox work surface.
  const toOrders = result.uploadType === "ORDER_SUMMARY";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${status.cls}`}>
          {status.label}
        </span>
        <span className="text-base">
          <span className="font-semibold text-good">저장 {result.successRows}건</span>
          <span className="text-muted"> · 중복 {result.skippedRows}건 · </span>
          <span className={result.failedRows > 0 ? "font-semibold text-bad" : "text-muted"}>
            실패 {result.failedRows}건
          </span>
        </span>
      </div>

      {result.errorMessage ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">{result.errorMessage}</p>
      ) : null}

      {result.sampleErrors.length > 0 ? (
        <div className="rounded-xl bg-canvas px-4 py-3">
          <p className="mb-2 text-base font-semibold">오류가 있는 행 (일부)</p>
          <ul className="space-y-1 text-sm text-muted">
            {result.sampleErrors.map((e, i) => (
              <li key={i}>
                {e.rowNumber}행: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {toOrders ? (
          <>
            <Link to="/orders" className="btn-primary inline-flex">
              주문·매출 보기
            </Link>
            <Link to="/" className="btn-ghost inline-flex">
              대시보드에서 확인하기
            </Link>
          </>
        ) : (
          <>
            <Link to="/inbox" className="btn-primary inline-flex">
              인박스에서 확인하기
            </Link>
            <Link to="/" className="btn-ghost inline-flex">
              대시보드에서 확인하기
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
