import { useCallback, useEffect, useState } from "react";
import type {
  KnowledgeBootstrapReport,
  LearnedKnowledgeChannelLine,
  LearnedKnowledgeSource,
  LearnedKnowledgeView,
} from "../../lib/types";
import { api } from "../../lib/apiClient";
import { Btn } from "../ui/Btn";
import { Status } from "../ui/Status";

/**
 * <b>Reviewnary가 배운 것</b> — what the company's operating history has already taught, where each piece came from,
 * and, per connected channel, which history can and cannot be learned.
 *
 * <p>Counts and two examples per source, from the same tables a case retrieves — so a number here is something a case
 * can actually use. A source a channel does not provide is named with its reason rather than shown as 0, because 0
 * reads as «you have none» and the truth is «this channel does not give it to us».
 *
 * <p>The one control reads the seller's own channel history (READ only) and learns from it. It never writes to a
 * channel and never changes an answer; a case that could use the new knowledge picks it up on its next preparation.
 */
export function LearnedKnowledge() {
  const [learned, setLearned] = useState<LearnedKnowledgeView | null | undefined>(undefined);
  const [lastRun, setLastRun] = useState<KnowledgeBootstrapReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setLearned((await api.getLearnedKnowledge()).learned);
    } catch {
      setLearned(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const learn = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await api.learnFromHistory();
      setLearned(response.learned);
      setLastRun(response.lastRun);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (learned === undefined) {
    return <p className="text-sm text-muted">확인하는 중…</p>;
  }
  if (learned === null) {
    return <p className="text-sm text-muted">배운 내용을 불러오지 못했습니다.</p>;
  }

  return (
    <div className="space-y-4" data-testid="learned-knowledge">
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {learned.sources.map((source) => (
          <SourceRow key={source.key} source={source} />
        ))}
      </ul>

      {learned.channels.length > 0 ? <ChannelLines lines={learned.channels} /> : null}

      {learned.historyReads.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted">
          {learned.historyReads.map((read) => (
            <li key={`${read.channelNameKo}-${read.readOn}`} className="break-keep">
              {read.channelNameKo}의 과거 문의를 {read.readOn ?? "이전에"} 읽었습니다 · {read.rowsRead}건
            </li>
          ))}
        </ul>
      ) : null}

      {learned.canLearnHistory ? (
        <div className="space-y-2">
          <Btn variant="outline" onClick={learn} disabled={busy}>
            {busy ? "과거 기록을 읽는 중…" : "과거 운영 기록에서 배우기"}
          </Btn>
          <p className="break-keep text-sm text-muted">
            연결된 채널의 지난 문의와 답변, 고객이 이야기한 상품의 상세 정보를 읽습니다. 채널에 아무것도 쓰거나
            보내지 않습니다.
          </p>
          {failed ? <p className="text-sm text-bad">과거 기록을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p> : null}
          {lastRun ? <RunSummary run={lastRun} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function SourceRow({ source }: { source: LearnedKnowledgeSource }) {
  return (
    <li className="space-y-2 p-3">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-ink">{source.labelKo}</span>
        <span className="text-ink tabular-nums">
          {source.key === "PRODUCT_DETAIL" ? `상품 ${source.count}개` : `${source.count}건`}
        </span>
        {source.latestOn ? <span className="text-sm text-muted">최근 {source.latestOn}</span> : null}
      </p>
      {source.examples.length > 0 ? (
        <ul className="space-y-1">
          {source.examples.map((example, i) => (
            <li key={i} className="break-keep text-sm">
              {example.title ? <span className="text-ink">{example.title} </span> : null}
              {example.excerpt ? <span className="text-muted">「{example.excerpt}」</span> : null}
              <span className="block text-xs text-muted">
                {[example.provenance, example.productName, example.capturedOn].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ChannelLines({ lines }: { lines: LearnedKnowledgeChannelLine[] }) {
  const channels = Array.from(new Set(lines.map((line) => line.channelNameKo)));
  return (
    <div className="space-y-3">
      {channels.map((channel) => (
        <div key={channel} className="space-y-1">
          <p className="text-sm font-medium text-ink">{channel}</p>
          <ul className="space-y-1">
            {lines
              .filter((line) => line.channelNameKo === channel)
              .map((line) => (
                <li key={line.source} className="flex flex-wrap items-start gap-2 text-sm">
                  {line.availability === "LEARNED" ? (
                    <Status tone="info">가져옴</Status>
                  ) : (
                    <Status tone="neutral">가져오지 못함</Status>
                  )}
                  <span className="break-keep text-muted">
                    {line.sourceLabelKo} · {line.sentenceKo}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Why the product-detail pass stopped early — the channel refused this connection, not any one product. */
const STOPPED_BY: Record<string, string> = {
  ENVIRONMENT_NOT_ALLOWED:
    "채널이 지금 연결 환경을 허용하지 않아 상품 상세를 읽지 못했습니다. 판매자센터 애플리케이션의 'API 호출 IP'를 확인해 주세요.",
  PERMISSION: "채널 애플리케이션에 상품 API 권한이 없어 상품 상세를 읽지 못했습니다.",
  CREDENTIAL: "채널 연결 정보가 더 이상 유효하지 않아 상품 상세를 읽지 못했습니다. 채널을 다시 연결해 주세요.",
  CHANNEL_REFUSED: "채널이 요청을 거절해 상품 상세를 읽지 못했습니다.",
};

function RunSummary({ run }: { run: KnowledgeBootstrapReport }) {
  const lines: string[] = [];
  for (const history of run.inquiryHistory) {
    const channel = history.channelNameKo ?? "채널";
    if (history.status === "READ") {
      lines.push(`${channel}: ${history.from}부터 문의 ${history.rowsRead}건을 읽었습니다.`);
    } else if (history.status === "ALREADY_READ") {
      lines.push(`${channel}: 과거 문의는 이미 읽었습니다.`);
    } else if (history.status === "IN_PROGRESS") {
      lines.push(`${channel}: 다른 수집이 진행 중이라 끝난 뒤 다시 시도해 주세요.`);
    } else {
      lines.push(`${channel}: 과거 문의를 읽지 못했습니다.`);
    }
  }
  lines.push(`기억하고 있는 지난 문의 답변은 ${run.answersRemembered}건입니다.`);
  for (const read of run.catalogue ?? []) {
    const channel = read.channelNameKo ?? "채널";
    if (read.status === "READ") {
      lines.push(`${channel}: 판매 상품 목록을 새로 읽었습니다.`);
    } else if (read.status === "FAILED") {
      lines.push(`${channel}: 판매 상품 목록을 읽지 못해 저장된 목록으로 진행했습니다.`);
    }
  }
  if (!run.productDetail.enabled) {
    lines.push("상품 상세 읽기는 지금 꺼져 있습니다.");
  } else if (run.productDetail.considered > 0) {
    const parts = [`상품 ${run.productDetail.considered}개를 확인해 상세 글 ${run.productDetail.indexed}개를 읽었습니다`];
    if (run.productDetail.imageOnly > 0) {
      parts.push(`이미지로만 된 상세페이지 ${run.productDetail.imageOnly}개는 읽지 못했습니다`);
    }
    lines.push(`${parts.join(" · ")}.`);
  }
  const stopped = run.productDetail.stoppedBy ? STOPPED_BY[run.productDetail.stoppedBy] : null;
  if (stopped) {
    lines.push(stopped);
  }
  if (run.productDetail.enabled && (run.productDetail.onSaleCatalogue ?? 0) > 0) {
    let line = `판매 중인 상품 ${run.productDetail.onSaleCatalogue}개 중 ${run.productDetail.covered}개의 상세·옵션·속성을 알고 있습니다.`;
    if ((run.productDetail.remaining ?? 0) > 0) {
      line += ` 나머지 ${run.productDetail.remaining}개는 다음 번에 읽습니다.`;
    }
    lines.push(line);
  }
  return (
    <ul className="space-y-1 rounded-xl border border-line bg-surface p-3 text-sm text-ink" aria-live="polite">
      {lines.map((line) => (
        <li key={line} className="break-keep">
          {line}
        </li>
      ))}
    </ul>
  );
}
