import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Section } from "../components/Section";
import { UploadResult } from "../components/UploadResult";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { isAxiosError } from "axios";
import type { IngestResult, UploadType } from "../lib/types";

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

  const queryChannel = params.get("channelId");
  const channelList = useMemo(() => channels ?? [], [channels]);

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
    } catch (e) {
      setError(backendMessage(e) ?? "업로드에 실패했습니다. 백엔드가 실행 중인지 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">파일 업로드</h1>
        <p className="mt-1 text-lg text-muted">리뷰·문의·주문/매출 파일을 올리면 대시보드에 반영됩니다.</p>
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
    </div>
  );
}
