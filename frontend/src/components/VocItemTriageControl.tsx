import { useId, useRef, useState } from "react";
import { api } from "../lib/apiClient";
import { SecureRandomUnavailableError, newCommandId } from "../lib/commandId";
import { TRIAGE_OPTIONS, asTriageDisposition } from "../lib/vocItems";
import type { TriageDisposition } from "../lib/types";

// Records what the operator concluded about one drill-down row. Nothing else: this
// drafts no reply, sends nothing, and touches no marketplace — "대응 필요" states a
// judgement, it does not promise an answer.
//
// Rendered only for a row that HAS an actionRef (see VocItemCard). A row without one is
// not decidable at all, and the honest rendering of that is no control — not a disabled
// one, which would read as "you may not", when the truth is "this row cannot carry a
// decision".

/** One user intent: a disposition plus the command id that identifies it to the server. */
interface Attempt {
  disposition: TriageDisposition;
  commandId: string;
}

export function VocItemTriageControl({
  accountId,
  actionRef,
  disposition,
}: {
  accountId: string;
  actionRef: string;
  disposition: TriageDisposition | null;
}) {
  // Server-confirmed state only. Seeded from the row and advanced ONLY after a success,
  // so a failed write leaves the UI showing what the server still holds. Optimism here
  // would show a decision that was never recorded.
  const [recorded, setRecorded] = useState<TriageDisposition | null>(disposition);
  const [pending, setPending] = useState<TriageDisposition | null>(null);
  const [failed, setFailed] = useState<TriageDisposition | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // The command id for the CURRENT intent. Held in a ref, not state: it must survive a
  // failed attempt without re-rendering, and it is identity rather than display.
  const attempt = useRef<Attempt | null>(null);
  // The duplicate-submission guard, and it MUST be a ref. The buttons are aria-disabled
  // rather than natively disabled (see below), so a click still fires the handler — and
  // `pending` is state, which does not update until the next render. Only a ref changes
  // synchronously enough to stop a second click in the same tick.
  const inFlight = useRef(false);
  const labelId = useId();

  const busy = pending != null;

  async function choose(next: TriageDisposition) {
    if (inFlight.current) {
      return; // a second click during flight is the same intent, not a new one
    }
    if (unavailable) {
      // Enforced here, not just advertised by aria-disabled: the buttons still receive
      // clicks (that is the price of keeping focus), so nothing else stops a later one.
      //
      // Honest about what this is worth: it changes NOTHING observable today, and no test
      // can distinguish it. Without it a later click re-mints, throws, and re-sets the same
      // two values, which React bails out of. It is unreachable-by-luck rather than by
      // design — the mint throwing deterministically and both setState calls being
      // idempotent — and the reasoning to re-derive that is longer than the guard. Kept so
      // the handler enforces what `inert` advertises, instead of leaving them agreeing by
      // coincidence.
      return;
    }
    if (next === recorded) {
      // Already what the server holds. Re-sending would append an audit row recording a
      // transition from a value to itself — noise in a trail whose job is to answer "what
      // changed, and when". The operator asked for nothing, so nothing happens.
      return;
    }
    // Reuse the command id ONLY when retrying the same failed intent: a retry is one
    // decision reaching the server twice, which the backend answers as a replay. A fresh
    // id would make it a second, independent decision and duplicate it in the trail.
    //
    // Any change to the requested disposition is a NEW intent and takes a new id —
    // including switching away from a failed attempt and back again, since the abandoned
    // one is no longer what is being asked for. Reusing an id across two different
    // decisions is a 409 by design.
    const reuse = attempt.current?.disposition === next && failed === next;
    let commandId: string;
    try {
      commandId = reuse ? attempt.current!.commandId : newCommandId();
    } catch (e) {
      // No id, no request — and no point offering a retry: this origin cannot mint one,
      // so the same click would fail identically forever.
      if (e instanceof SecureRandomUnavailableError) {
        setUnavailable(true);
        setFailed(null);
        return;
      }
      throw e;
    }
    attempt.current = { disposition: next, commandId };

    inFlight.current = true;
    setPending(next);
    setFailed(null);
    try {
      const result = await api.recordVocItemTriage(accountId, actionRef, {
        commandId,
        disposition: next,
      });
      // Trust the server's CURRENT value over the one we asked for — a replay of a
      // superseded command reports where things actually stand — but only once it is a
      // value this client can name. An unrecognised one would render as "판단 전", i.e. as
      // no decision at all, after a SUCCESSFUL save.
      const confirmed = asTriageDisposition(result?.disposition);
      if (confirmed == null) {
        // Deliberately NOT clearing `attempt.current`: the write may well have landed, so
        // the retry has to carry the SAME command id and let the server replay it rather
        // than record a second decision.
        setFailed(next);
        return;
      }
      setRecorded(confirmed);
      attempt.current = null;
    } catch {
      // Deliberately no error detail on screen. The failure the operator can act on is
      // "it did not save, try again"; a status code or server message tells them nothing
      // they can use and risks surfacing something this UI should not.
      setFailed(next);
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span id={labelId} className="text-sm text-muted">
          처리 상태
        </span>
        {/* Toggle buttons in a group, NOT a radiogroup. A radiogroup promises arrow-key
            navigation and a roving tabindex, which this does not implement; claiming the
            role would advertise a keyboard contract that is not there. `aria-pressed`
            says the same thing a radio's checked state would — this is the current
            choice — without the promise. */}
        <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
          {TRIAGE_OPTIONS.map((option) => {
            const isRecorded = recorded === option.value;
            const isPending = pending === option.value;
            // Inert while a write is in flight, on the choice already held, and forever if
            // this origin cannot mint a command id.
            const inert = busy || isRecorded || unavailable;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isRecorded}
                // aria-disabled, NOT the native attribute. Disabling the element the
                // operator just activated makes the browser blur it: focus drops to
                // <body>, and on success the button stays disabled so it never comes
                // back. In a long list that costs a keyboard user their place on every
                // single decision. aria-disabled announces "unavailable" while leaving the
                // button focusable; `choose` enforces the guard, so nothing gets through.
                aria-disabled={inert}
                aria-busy={isPending}
                onClick={() => choose(option.value)}
                className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
                  isRecorded
                    ? "bg-brand/10 text-brand-700"
                    : `bg-canvas text-muted ${inert ? "opacity-40" : ""}`
                }`}
              >
                {option.label}
                {/* aria-hidden, so the pending marker stays out of the accessible NAME.
                    Appending it to the label instead would rename the button mid-click —
                    "대응 필요" becomes "대응 필요…" — which a screen reader announces as a
                    new control, and which makes the button unfindable by its own name. The
                    state belongs in aria-busy and the live region below; this is decoration. */}
                {isPending ? <span aria-hidden="true">…</span> : null}
              </button>
            );
          })}
        </div>
        {/* The absence of a decision is stated plainly rather than left blank — a blank
            row reads as "nothing here", when the fact is "nobody has decided yet", which
            is exactly what this surface exists to resolve. "판단 전" says that: a decision
            is still to come. It is not a fourth option, and not a classification. */}
        {recorded == null && !busy ? (
          <span className="text-sm italic text-muted">판단 전</span>
        ) : null}
      </div>
      {/* Mounted always, with only its TEXT toggling. A live region has to exist in the
          accessibility tree before its content changes, or assistive tech never registers
          on it — mounting the region and the text in one commit is the classic way to get
          silence. That matters more here than usual: the busy state has nowhere else to go.
          The button's accessible name is deliberately held stable, the pending ellipsis is
          aria-hidden, and aria-busy on a focused button is not reliably announced — so if
          this region does not fire, a screen-reader operator gets NO feedback that their
          decision is saving. Empty renders as nothing, so there is no visual cost. */}
      <p aria-live="polite" className="text-sm text-muted">
        {busy ? "저장 중…" : ""}
      </p>
      {unavailable ? (
        // A capability limit, not a failure: says what is wrong and does NOT invite a
        // retry, because no number of retries can mint a command id on this origin.
        <p role="alert" className="text-sm text-bad">
          이 환경에서는 처리 상태를 기록할 수 없습니다. 보안 연결(HTTPS)로 접속해 주세요.
        </p>
      ) : null}
      {failed != null && !unavailable ? (
        // role=alert so the failure is announced rather than only shown: the operator
        // has just been told, visually, that nothing changed, and a silent revert is how
        // someone concludes they already decided.
        <p role="alert" className="text-sm text-bad">
          처리 상태를 저장하지 못했습니다. 다시 시도해 주세요.
        </p>
      ) : null}
    </div>
  );
}
