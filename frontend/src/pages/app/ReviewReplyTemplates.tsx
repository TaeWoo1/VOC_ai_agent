import { useEffect, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { Panel } from "../../components/ui/Panel";
import { Disclosure } from "../../components/ui/Disclosure";
import { Btn } from "../../components/ui/Btn";
import { api } from "../../lib/apiClient";
import { backendMessage } from "../../components/connect/channelShared";
import { labelledTemplates } from "../../lib/reviewReplyTemplates";
import type { ReviewReplyTemplateLabel } from "../../lib/reviewReplyTemplates";
import type { ReviewReplyTemplateView } from "../../lib/types";

/**
 * 리뷰 답변 문구 — the wording this company answers reviews with.
 *
 * <b>The line this screen has to hold.</b> A template decides HOW a review is answered, never WHAT is
 * true about the order, the product or what the company will do about it. So the page says that in the
 * seller's own words at the top, and nothing on it can pull a fact into a template: there is no
 * placeholder syntax, no variable list, no "insert product name" control, and the backend refuses to
 * grow one.
 *
 * <b>No internal vocabulary.</b> No template key, no category string, no provider, no rule, no prompt.
 * Each block is a name a seller would say out loud, one line saying when it is used, the words that
 * trigger it where there are any, a text box, and two buttons.
 *
 * <b>Saving changes the next suggestion and nothing else.</b> A draft already saved keeps its version
 * and its fingerprint, and an approved reply is untouched — the page says so rather than leaving the
 * seller to wonder whether pressing 저장 rewrote something they already approved.
 */
export function ReviewReplyTemplates() {
  const [templates, setTemplates] = useState<ReviewReplyTemplateView[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .getReviewReplyTemplates()
      .then((view) => active && setTemplates(view.templates))
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, []);

  const replace = (saved: ReviewReplyTemplateView) =>
    setTemplates((current) =>
      (current ?? []).map((t) => (t.key === saved.key ? saved : t)),
    );

  return (
    <>
      <PageHead
        title="리뷰 답변 문구"
        description="리뷰에 답변할 때 처음 채워지는 문구입니다. 유형별로 바꿔 두시면 회사 말투로 시작할 수 있습니다."
      />

      {loadError ? (
        <Panel title="리뷰 답변 문구">
          <p className="text-warn">문구를 불러오지 못했습니다.</p>
        </Panel>
      ) : templates === null ? (
        <Panel title="리뷰 답변 문구">
          <p className="text-muted">불러오는 중…</p>
        </Panel>
      ) : (
        <div className="space-y-4">
          <Disclosure label="어떻게 쓰이나요">
            <ul className="mt-2 space-y-1.5 break-keep text-sm text-muted">
              <li>리뷰를 열면 아래 문구가 답변 초안에 먼저 채워집니다. 보내기 전에 언제든 고치실 수 있습니다.</li>
              <li>말투와 표현만 정합니다. 배송일·환불·교환 같은 약속은 문구가 대신 정하지 않습니다.</li>
              <li>저장하면 <strong className="font-semibold text-ink">다음에 만드는 초안부터</strong> 반영됩니다. 이미 승인한 답변은 그대로입니다.</li>
            </ul>
          </Disclosure>

          {/* One list of seven rows, not seven cards (Phase 4). */}
          <ul aria-label="리뷰 답변 문구" className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line bg-surface">
            {labelledTemplates(templates).map(({ template, label }) => (
              <TemplateEditor key={template.key} template={template} label={label} onChanged={replace} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function TemplateEditor({
  template,
  label,
  onChanged,
}: {
  template: ReviewReplyTemplateView;
  label: ReviewReplyTemplateLabel;
  onChanged: (saved: ReviewReplyTemplateView) => void;
}) {
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState<"saving" | "resetting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"saved" | "restored" | null>(null);

  // The server's own text wins after a save or a restore — it is what the next draft will start from.
  useEffect(() => {
    setBody(template.body);
  }, [template.body]);

  const dirty = body !== template.body;

  const run = async (kind: "saving" | "resetting") => {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      const saved =
        kind === "saving"
          ? await api.saveReviewReplyTemplate(template.key, body)
          : await api.resetReviewReplyTemplate(template.key);
      onChanged(saved);
      setBody(saved.body);
      setDone(kind === "saving" ? "saved" : "restored");
    } catch (e) {
      // The backend's own sentence: it names what was refused, which is the only actionable part.
      setError(backendMessage(e) ?? "저장하지 못했습니다. 입력하신 내용을 확인해 주세요.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li>
      <section aria-label={label.name} className="px-5 py-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="break-keep text-base font-semibold text-ink">{label.name}</h2>
        <span className="text-sm text-muted">{template.customized ? "직접 정한 문구" : "기본 문구"}</span>
      </div>
      <p className="mb-1 break-keep text-sm text-muted">{label.when}</p>
      {template.matchWords.length > 0 ? (
        <p className="mb-3 break-keep text-sm text-muted">
          이런 낱말이 있을 때: {template.matchWords.join(" · ")}
        </p>
      ) : null}

      <label className="block">
        <span className="sr-only">{label.name} 문구</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base leading-relaxed focus:border-brand focus:outline-none"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn size="sm" onClick={() => void run("saving")} disabled={busy !== null || !dirty}>
          {busy === "saving" ? "저장 중…" : "저장"}
        </Btn>
        <Btn
          size="sm"
          variant="outline"
          onClick={() => void run("resetting")}
          disabled={busy !== null || !template.customized}
        >
          기본값 복원
        </Btn>
        {error ? <span className="break-keep text-sm text-bad">{error}</span> : null}
        {!error && done === "saved" ? <span className="text-sm text-good">저장했습니다.</span> : null}
        {!error && done === "restored" ? (
          <span className="text-sm text-good">기본 문구로 되돌렸습니다.</span>
        ) : null}
      </div>
      </section>
    </li>
  );
}
