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

// 문의 first, then 리뷰, then 주문·매출 — matches the step-1 wording the operator
// reads top to bottom. ORDER_SUMMARY stays: it feeds the Orders dashboard.
const TYPES: Array<{ value: UploadType; label: string }> = [
  { value: "INQUIRY", label: "문의" },
  { value: "REVIEW", label: "리뷰" },
  { value: "ORDER_SUMMARY", label: "주문·매출" },
];

const ACCEPT = ".csv,.xlsx";

/** True when a dropped/selected file has a CSV or XLSX extension. */
function hasAllowedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".xlsx");
}

/** A small numbered step header, so the page reads as ① 종류 ② 채널 ③ 파일 ④ 결과. */
function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand-700">
        {n}
      </span>
      <span className="text-base font-semibold text-ink">{children}</span>
    </div>
  );
}

export function Upload() {
  const [params] = useSearchParams();
  const { data: channels } = useApiData(() => api.getChannels());
  const [channelId, setChannelId] = useState("");
  const [uploadType, setUploadType] = useState<UploadType>("INQUIRY");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
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

  function pickFile(f: File | null) {
    if (!f) {
      setFile(null);
      return;
    }
    if (!hasAllowedExtension(f.name)) {
      setError("CSV 또는 XLSX 파일만 올릴 수 있습니다.");
      return;
    }
    setError(null);
    setFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files?.[0] ?? null);
  }

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
      setError(backendMessage(e) ?? "업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">자료 업로드</h1>
        <p className="mt-1 text-lg text-muted">
          리뷰·문의·주문/매출 파일을 올리면 대시보드와 인박스에 반영됩니다.
        </p>
      </div>

      <Section title="업로드">
        <div className="space-y-6">
          <div>
            <StepLabel n={1}>무엇을 업로드하나요?</StepLabel>
            <div className="flex flex-wrap gap-2">
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
          </div>

          <div>
            <StepLabel n={2}>어느 채널 자료인가요?</StepLabel>
            <div className="flex flex-wrap gap-2">
              {channelList.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChannelId(c.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    channelId === c.id ? "bg-ink text-white" : "bg-canvas text-muted"
                  }`}
                >
                  {c.nameKo}
                </button>
              ))}
            </div>
          </div>

          <div>
            <StepLabel n={3}>파일 선택 / 드래그 앤 드롭</StepLabel>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
                dragging ? "border-brand bg-brand/5" : "border-line bg-canvas"
              }`}
            >
              <input
                type="file"
                accept={ACCEPT}
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              {file ? (
                <p className="text-base font-semibold text-ink">{file.name}</p>
              ) : (
                <>
                  <p className="text-base font-medium text-ink">
                    여기로 파일을 끌어다 놓거나 클릭해서 선택하세요
                  </p>
                  <p className="mt-1 text-sm text-muted">CSV 또는 XLSX</p>
                </>
              )}
            </label>

            <button
              type="button"
              onClick={() => setGuideOpen((v) => !v)}
              aria-expanded={guideOpen}
              className="mt-3 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {guideOpen ? "업로드 양식 안내 접기 ▴" : "업로드 양식 안내 ▾"}
            </button>
            {guideOpen ? (
              <div className="mt-2 rounded-xl bg-canvas px-4 py-3 text-base">
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
                  className="mt-3 text-sm text-brand-700 underline-offset-2 hover:underline"
                >
                  샘플 CSV 다운로드
                </button>
              </div>
            ) : null}
          </div>

          {error ? <p className="text-base text-bad">{error}</p> : null}

          <button type="button" className="btn-primary" onClick={onUpload} disabled={busy}>
            {busy ? "업로드 중…" : "업로드"}
          </button>
        </div>
      </Section>

      {result ? (
        <Section title="업로드 결과">
          <UploadResult result={result} />
        </Section>
      ) : null}

      <Section title="최근 업로드 내역">
        {jobsError ? (
          <p className="text-base text-bad">
            업로드 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
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
