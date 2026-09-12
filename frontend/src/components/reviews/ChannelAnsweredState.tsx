/**
 * 「이미 답변 완료」 — the channel's own statement, said before anyone decides anything.
 *
 * <p><b>It is not the triage decision and it does not make one.</b> The controls below are untouched:
 * a review answered on the channel may still be one this operator has never looked at, and writing
 * 「처리 완료」 here would record a decision nobody made. What it does say is that the road to a
 * SECOND public reply is closed — new draft, new approval and the guided run are all withheld by the
 * server (`canSave` / `canApprove` / `canStartSubmissionRun`) and refused by it — so this is a
 * sentence about a real closure rather than a warning the product then walks past.
 *
 * <p>Rendered for ANSWERED alone. 「아직 답변이 없습니다」 would be the channel's silence dressed as a
 * statement: UNKNOWN means no usable answer, which is a different fact from PENDING.
 */
export function ChannelAnsweredState({ state }: { state: string | null }) {
  if (state !== "ANSWERED") return null;
  return (
    <div className="rounded-xl border border-line bg-canvas p-3" data-testid="channel-answered-state">
      <p className="break-keep text-sm font-semibold text-ink">채널에 이미 답변이 등록된 리뷰입니다</p>
      <p className="break-keep text-sm leading-relaxed text-muted">
        판매자센터에 답변이 있다고 채널이 알려왔습니다. 새 초안·승인·판매자센터 답변하기는 열리지 않습니다.
        처리 상태는 아래에서 따로 기록할 수 있습니다.
      </p>
    </div>
  );
}
