import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { Section } from "./Section";
import { api } from "../lib/apiClient";
import {
  BACKFILL_DATA_TYPES,
  PRESETS,
  type PresetKey,
  resolvePresetRange,
  validateBackfill,
} from "../lib/backfillPresets";

// Operator-initiated bounded backfill: pick a date range (preset or custom) and
// one or more data types, then run a synchronous collection per type through the
// existing backfill runtime path. Channel-generic — it offers whatever the channel
// supports; the backend fails closed for anything it cannot serve.

function backendMessage(e: unknown): string | null {
  if (isAxiosError(e)) {
    const data = e.response?.data as { message?: string } | undefined;
    return data?.message ?? null;
  }
  return null;
}

interface RunResult {
  dataType: string;
  label: string;
  ok: boolean;
  detail: string;
}

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  BACKFILL_DATA_TYPES.map((t) => [t.value, t.label]),
);

export function BackfillPanel({
  accountId,
  onCompleted,
}: {
  accountId: string;
  onCompleted?: () => void;
}) {
  const [preset, setPreset] = useState<PresetKey>("recent7");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [selected, setSelected] = useState<string[]>(["REVIEW", "INQUIRY"]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve "today"-relative presets at render; custom uses the typed inputs.
  const range = useMemo(() => resolvePresetRange(preset, new Date(), custom), [preset, custom]);

  function toggleType(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  async function run() {
    const check = validateBackfill(range, selected);
    if (!check.ok) {
      setError(check.error ?? "입력을 확인해 주세요.");
      setResults(null);
      return;
    }
    setError(null);
    setRunning(true);
    setResults(null);
    // Order the runs by the panel's display order for a stable result list.
    const ordered = BACKFILL_DATA_TYPES.filter((t) => selected.includes(t.value));
    const collected: RunResult[] = [];
    for (const t of ordered) {
      try {
        const runView = await api.backfill(accountId, {
          dataType: t.value,
          startDate: range.from,
          endDate: range.to,
        });
        collected.push({
          dataType: t.value,
          label: t.label,
          ok: runView.status !== "FAILED",
          detail: `저장 ${runView.successRows} · 건너뜀 ${runView.skippedRows} · 실패 ${runView.failedRows}`,
        });
      } catch (e) {
        collected.push({
          dataType: t.value,
          label: t.label,
          ok: false,
          detail: backendMessage(e) ?? "수집에 실패했습니다.",
        });
      }
    }
    setResults(collected);
    setRunning(false);
    onCompleted?.();
  }

  return (
    <Section title="기간 지정 수집">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-semibold text-muted">수집 기간</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={`rounded-xl px-4 py-2 text-base font-semibold ${
                  preset === p.key ? "bg-brand/10 text-brand-700" : "bg-canvas text-muted"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className="rounded-xl border border-line px-3 py-2 text-base focus:border-brand focus:outline-none"
              />
              <span className="text-muted">~</span>
              <input
                type="date"
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className="rounded-xl border border-line px-3 py-2 text-base focus:border-brand focus:outline-none"
              />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {range.from} ~ {range.to}
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-muted">수집할 데이터</p>
          <div className="flex flex-wrap gap-2">
            {BACKFILL_DATA_TYPES.map((t) => {
              const on = selected.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => toggleType(t.value)}
                  className={`rounded-xl px-4 py-2 text-base font-semibold ${
                    on ? "bg-good/10 text-good" : "bg-canvas text-muted"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {error ? <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">{error}</p> : null}

        <button type="button" onClick={run} disabled={running} className="btn-primary">
          {running ? "수집 중…" : "이 기간 수집하기"}
        </button>

        {results ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {results.map((r) => (
              <li key={r.dataType} className="flex items-center justify-between px-4 py-3">
                <span className="text-base font-semibold">{TYPE_LABEL[r.dataType] ?? r.label}</span>
                <span className={`text-sm font-semibold ${r.ok ? "text-good" : "text-bad"}`}>
                  {r.detail}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
  );
}
