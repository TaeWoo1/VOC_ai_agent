import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Section } from "../components/Section";
import { UploadResult } from "../components/UploadResult";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { isAxiosError } from "axios";
import { COLUMN_HELP, downloadCsv } from "../lib/sampleData";
import { relativeTime } from "../lib/format";
import type { IngestResult, SyncJobView, UploadType } from "../lib/types";

/** Pull the backend's error message out of an Axios error, if present. */
function backendMessage(e: unknown): string | null {
  if (isAxiosError(e)) {
    const data = e.response?.data as { message?: string } | undefined;
    return data?.message ?? null;
  }
  return null;
}

const TYPES: Array<{ value: UploadType; label: string }> = [
  { value: "REVIEW", label: "리뷰" },
  { value: "INQUIRY", label: "문의" },
  { value: "ORDER_SUMMARY", label: "주문·매출" },
];

export function Upload() {
  const [params] = useSearchParams();
  const { data: channels } = useApiData(() => api.getChannels());
  const [channelId, setChannelId] = useState("");
  const [uploadType, setUploadType] = useState<UploadType>("REVIEW");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [jobs, setJobs] = useState<SyncJobView[]>([]);
  const [jobsError, setJobsError] = useState(false);

  const queryChannel = params.get("channelId");
  const channelList = useMemo(() => channels ?? [], [channels]);

  // Strict read: on backend failure show an explicit error, never a fake history.
  const loadJobs = useCallback(() => {
    api
      .getSyncJobsStrict()
      .then((j) => {
        setJobs(j);
        setJobsError(false);
      })
      .catch(() => {
        setJobs([]);
        setJobsError(true);
      });
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (channelId) {
      return;
    }
    if (queryChannel) {
      setChannelId(queryChannel);
    } else if (channelList.length > 0) {
      setChannelId(channelList[0].id);
    }
  }, [queryChannel, channelList, channelId]);

  async function onUpload() {
    if (!channelId) {
      setError("채널을 선택해 주세요.");
      return;
    }
    if (!file) {
      setError("CSV 또는 XLSX 파일을 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.uploadFile(channelId, uploadType, file);
      setResult(res);
      loadJobs();
    } catch (e) {
      setError(backendMessage(e) ?? "업로드에 실패했습니다. 백엔드가 실행 중인지 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">자동 수집 전, 파일로 먼저 확인하기</h1>
        <p className="mt-1 text-lg text-muted">리뷰·문의·주문/매출 파일을 올리면 대시보드에 반영됩니다.</p>
        <p className="mt-2 rounded-xl bg-brand/5 px-4 py-3 text-base text-muted">
          장기적으로는 판매자센터 API/자동 수집으로 연결되며, 파일 업로드는 초기 검증과 예외 상황을 위한 백업 방식입니다.
        </p>
      </div>

      <Section title="업로드">
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-base font-semibold">채널</label>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-3 text-lg focus:border-brand focus:outline-none"
            >
              {channelList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameKo}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-base font-semibold">데이터 종류</label>
            <div className="flex gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setUploadType(t.value)}
                  className={`rounded-xl px-4 py-2.5 text-base font-semibold ${
                    uploadType === t.value ? "bg-brand text-white" : "bg-canvas text-muted"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-xl bg-canvas px-4 py-3 text-base">
              <p>
                <span className="font-semibold text-ink">필수 열:</span>{" "}
                <span className="text-muted">{COLUMN_HELP[uploadType].required}</span>
              </p>
              <p className="mt-1">
                <span className="font-semibold text-ink">선택 열:</span>{" "}
                <span className="text-muted">{COLUMN_HELP[uploadType].optional}</span>
              </p>
              <p className="mt-1 text-sm text-muted">
                머리글은 한글 또는 영문 모두 인식합니다. 같은 파일을 다시 올려도 중복은 자동으로 건너뜁니다.
              </p>
              <button
                type="button"
                onClick={() => downloadCsv(uploadType)}
                className="btn-ghost mt-3 px-4 py-2 text-base"
              >
                샘플 CSV 다운로드
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-base font-semibold">파일 (CSV 또는 XLSX)</label>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-base file:mr-4 file:rounded-xl file:border-0 file:bg-brand/10 file:px-4 file:py-2.5 file:font-semibold file:text-brand-700"
            />
          </div>

          {error ? <p className="text-base text-bad">{error}</p> : null}

          <button type="button" className="btn-primary" onClick={onUpload} disabled={busy}>
            {busy ? "업로드 중…" : "업로드"}
          </button>
        </div>
      </Section>

      {result ? (
        <Section title="결과">
          <UploadResult result={result} />
        </Section>
      ) : null}

      <Section title="최근 업로드 내역">
        {jobsError ? (
          <p className="text-base text-bad">
            업로드 내역을 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
          </p>
        ) : jobs.length === 0 ? (
          <p className="text-base text-muted">아직 업로드 내역이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-canvas px-2.5 py-1 text-sm font-semibold">
                    {jobLabel(j.uploadType)}
                  </span>
                  <span className={`text-sm font-semibold ${jobStatusColor(j.status)}`}>
                    {jobStatusLabel(j.status)}
                  </span>
                </div>
                <span className="text-sm text-muted">
                  저장 {j.successRows} · 건너뜀 {j.skippedRows} · 실패 {j.failedRows} ·{" "}
                  {relativeTime(j.finishedAt ?? j.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function jobLabel(type: string | null): string {
  switch (type) {
    case "REVIEW":
      return "리뷰";
    case "INQUIRY":
      return "문의";
    case "ORDER_SUMMARY":
      return "주문·매출";
    default:
      return type ?? "-";
  }
}

function jobStatusLabel(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "성공";
    case "PARTIAL":
      return "일부 성공";
    case "FAILED":
      return "실패";
    default:
      return status;
  }
}

function jobStatusColor(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "text-good";
    case "PARTIAL":
      return "text-warn";
    default:
      return "text-bad";
  }
}
