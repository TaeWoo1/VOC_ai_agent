import { Link } from "react-router-dom";
import type { IngestResult } from "../lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  SUCCESS: { label: "성공", cls: "bg-good/10 text-good" },
  PARTIAL: { label: "일부 성공", cls: "bg-warn/10 text-warn" },
  FAILED: { label: "실패", cls: "bg-bad/10 text-bad" },
};

export function UploadResult({ result }: { result: IngestResult }) {
  const status = STATUS[result.status] ?? STATUS.FAILED;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-xl font-bold">업로드 결과</span>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${status.cls}`}>
          {status.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tally label="전체" value={result.totalRows} />
        <Tally label="저장됨" value={result.successRows} tone="good" />
        <Tally label="중복 건너뜀" value={result.skippedRows} tone="muted" />
        <Tally label="실패" value={result.failedRows} tone={result.failedRows > 0 ? "bad" : "muted"} />
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

      <Link to="/" className="btn-primary inline-flex">
        대시보드에서 확인하기
      </Link>
    </div>
  );
}

function Tally({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "good" | "bad" | "muted";
}) {
  const cls =
    tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <div className="rounded-xl bg-canvas px-4 py-3 text-center">
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-2xl font-bold ${cls}`}>{value.toLocaleString("ko-KR")}</p>
    </div>
  );
}
