/**
 * **The confirmation surface, hosted in a run's own browser — one implementation, every live CLI.**
 *
 * {@link file://./operator-confirm.ts} owns what makes a confirmation trustworthy: a per-checkpoint token
 * nothing outside the process sees, a trusted-press gate, and a wait that fails closed on every axis. This
 * module owns the part that used to be copied into each CLI: opening a SellerOps-owned tab, pinning it, raising
 * it when it arms, keeping it out of the pages the run measures, and printing the same words the operator is
 * about to press against.
 *
 * It exists because the pattern was proved once, live, in the WING selector recorder — and every other live CLI
 * in this package was still advancing on a `.ready` file, which is a channel a language model can produce. The
 * cure for that is not a second careful implementation; it is one implementation the others call.
 *
 * ## What a host guarantees
 *
 *  1. **The surface is SellerOps'.** A fresh `about:blank` tab in the run's own context. Never an overlay on
 *     the marketplace page: these runs claim to add nothing to the seller's screen, and a button injected into
 *     it would retire that claim to buy a convenience.
 *  2. **It is pinned.** The arm script is self-mounting — it paints onto whatever document the tab holds — so a
 *     tab the operator navigated is refused rather than painted on, and the wait fails closed.
 *  3. **The run cannot read it.** Drivers that resolve "the active page" take the NEWEST tab; an unfiltered
 *     context hands them the blank confirmation page and they report a confident reading of nothing.
 *     {@link OperatorConfirmHost.contextLike} is the one place that knows both pages exist.
 *  4. **The run raises it.** On 2026-08-13 an operator could not find the window the surface was in, and
 *     raising it from the OS opened a THIRD blank window inside the run's own browser (Chrome routes a second
 *     launch on one user-data-dir into the running instance). Playwright raises the TAB, and cannot do that.
 *
 * ## What it does NOT do
 *
 * It does not decide anything. A host hands back {@link OperatorConfirmation} and the CLI decides what a
 * `timeout` or an `abort` means for its own run — every one of them treats anything but `ready` as "do not
 * proceed", but that is the CLI's own fail-closed branch, stated where its consequences are.
 */
import {
  OPERATOR_CONFIRM_BUTTON_LABEL,
  OPERATOR_CONFIRM_PAGE_TITLE,
  awaitOperatorConfirmation,
  mintOperatorConfirmToken,
  pageEvaluateTransport,
  type OperatorConfirmAsk,
  type OperatorConfirmVerdict,
  type OperatorConfirmation,
} from "./operator-confirm";

/**
 * The ONLY document a confirmation surface may be armed on. A fresh `newPage()` is `about:blank` and stays that
 * way because nothing in a run navigates it — so any other value means the tab is not ours any more.
 */
export const CONFIRM_SURFACE_URL = "about:blank";

/** Default cadence. Half a second is imperceptible to a person and costs one trivial evaluate. */
export const CONFIRM_POLL_MS = 500;
/** Default budget: generous, because the operator may be logging in and navigating a marketplace by hand. */
export const CONFIRM_TIMEOUT_MS = 20 * 60_000;

/** The page surface a host needs. Structural, so the whole module is unit-tested without a browser. */
export interface ConfirmHostPage {
  url(): string;
  evaluate<T>(script: string): Promise<T>;
  bringToFront(): Promise<void>;
}

/** The context surface a host needs. `on` is passed through untouched for callers that watch for a close. */
export interface ConfirmHostContext {
  pages(): ConfirmHostPage[];
  newPage(): Promise<ConfirmHostPage>;
  on(event: "close", handler: () => void): void;
}

/**
 * A context wrapper with the confirmation tab filtered out — the shape the Action Window drivers accept for
 * resolving their own active page.
 */
export interface OperatorSafeContext {
  pages(): ConfirmHostPage[];
  on(event: "close", handler: () => void): void;
}

export interface OperatorConfirmHostOptions {
  /**
   * Whether the operator has asked to stop. Checked before every poll and before arming, so Ctrl-C and the run's
   * abort sentinel both win over a confirmation that lands in the same tick.
   *
   * **Abort stays a file, deliberately.** A forged abort stops a run, which is the safe direction; only
   * ADVANCING needs a channel a model cannot reach.
   */
  readonly aborted: () => boolean;
  /** Printed in the copy tail so the operator can always see how to stop. Omit when the run has no abort file. */
  readonly abortPath?: string;
  readonly pollMs?: number;
  readonly timeoutMs?: number;
  /** Sanitized observability: the VERDICT only. The token and the event never reach a caller. */
  readonly onVerdict?: (verdict: OperatorConfirmVerdict) => void;
  /** Where the terminal copy goes. Defaults to `console.error`, which is where every CLI here prints. */
  readonly print?: (line: string) => void;
}

export interface OperatorConfirmHost {
  /**
   * The page the run reads: the operator's own tab, captured BEFORE the confirmation tab was opened so it is
   * the entry page in every ordering.
   */
  readonly entryPage: ConfirmHostPage;
  /** The run's pages with the confirmation tab removed. */
  readonly contextLike: OperatorSafeContext;
  /**
   * Arm one checkpoint and wait for a verified press. A fresh token every time: a press held over from the
   * previous screen cannot advance this one.
   */
  confirm(ask: OperatorConfirmAsk, opts?: { readonly timeoutMs?: number }): Promise<OperatorConfirmation>;
  /**
   * Print an ask to the terminal in the same words {@link confirm} will render — the same object, so the two
   * cannot say different things. Called by the run at the moment it decides what to ask next; `confirm` does not
   * print for itself, because several CLIs decide the copy one step before they are ready to wait on it.
   */
  announce(ask: OperatorConfirmAsk): void;
}

/**
 * The paragraph that says what advances a checkpoint — appended to every ask, in the surface AND the terminal.
 *
 * Not decoration. The channel this replaced let the instruction reach the operator through a chat paraphrase and
 * the confirmation come back the same way, and neither end was the run.
 */
export function confirmTailLines(abortPath?: string, label: string = OPERATOR_CONFIRM_BUTTON_LABEL): readonly string[] {
  return [
    `계속하려면 '${OPERATOR_CONFIRM_PAGE_TITLE}' 탭의 [${label}] 버튼을 직접 누르세요.`,
    "대화창의 'ready'나 파일 생성으로는 진행되지 않습니다.",
    abortPath ? `중단: Ctrl+C, 또는 이 파일 생성 — ${abortPath}` : "중단: Ctrl+C.",
  ];
}

/**
 * An ask, plus the one paragraph that says what advances it — and it is the ONLY place that paragraph appears.
 * The surface's own note used to repeat it, so the same three sentences reached the operator twice on one
 * screen; the button's label is threaded through so the tail names the button the ask actually renders.
 */
export function withConfirmTail(ask: OperatorConfirmAsk, abortPath?: string): OperatorConfirmAsk {
  return { ...ask, lines: [...ask.lines, "", ...confirmTailLines(abortPath, ask.confirmLabel)] };
}

/** Print an ask to the terminal in the same words the confirmation surface shows. */
export function printOperatorAsk(ask: OperatorConfirmAsk, print: (line: string) => void = console.error): void {
  print("");
  print(`${ask.title} — ${ask.headline}`);
  for (const line of ask.lines) print(line === "" ? "" : `  ${line}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Open the confirmation tab in `ctx` and return the host that owns it.
 *
 * Called once, immediately after the context is launched and BEFORE the run reads anything: the entry page has
 * to be captured while it is still the only one.
 */
export async function attachOperatorConfirmTab(
  ctx: ConfirmHostContext,
  opts: OperatorConfirmHostOptions,
): Promise<OperatorConfirmHost> {
  const entryPage = ctx.pages()[0] ?? (await ctx.newPage());
  const confirmPage = await ctx.newPage();
  const print = opts.print ?? ((line: string) => console.error(line));

  /**
   * **The confirmation tab is checked, not trusted, on every evaluation.**
   *
   * The arm script paints itself onto whatever document the tab holds, and nothing stops an operator from
   * typing a URL into it — the first arming raises it at exactly the moment the ask says "log in and navigate
   * yourself", which is when someone would. Arming after that would restyle a LIVE MARKETPLACE PAGE and rewrite
   * its title, retiring the run's standing claim that it adds nothing there. A navigated tab throws, which the
   * wait reads as `UI_NOT_ARMED` and fails closed.
   */
  const evaluateOnSurface = (script: string): Promise<unknown> => {
    if (confirmPage.url() !== CONFIRM_SURFACE_URL) {
      return Promise.reject(new Error("the confirmation tab is no longer the SellerOps surface"));
    }
    return confirmPage.evaluate<unknown>(script);
  };

  const contextLike: OperatorSafeContext = {
    pages: () => ctx.pages().filter((p) => p !== confirmPage),
    on: (event, handler) => ctx.on(event, handler),
  };

  return {
    entryPage,
    contextLike,
    announce: (ask) => printOperatorAsk(withConfirmTail(ask, opts.abortPath), print),
    // `timeoutMs` per call, because one run's checkpoints are not all the same size: a login gate and a
    // "find and open one application" walk had different budgets before this host existed, and collapsing
    // them into the host's default silently gave the shorter one the longer wait.
    confirm: (ask, callOpts) => {
      const full = withConfirmTail(ask, opts.abortPath);
      return awaitOperatorConfirmation(
        {
          transport: pageEvaluateTransport(evaluateOnSurface),
          aborted: opts.aborted,
          sleep,
          // Best-effort: a surface that cannot be raised is still one the operator can switch to, so a failure
          // here must not end a run that is otherwise ready to be confirmed. Wrapped rather than passed, because
          // a SYNCHRONOUS throw from a host page would escape a `.catch` on the returned promise.
          onArmed: async () => {
            try {
              await confirmPage.bringToFront();
            } catch {
              /* the operator can still switch to it */
            }
          },
          onVerdict: opts.onVerdict,
        },
        full,
        {
          token: mintOperatorConfirmToken(),
          pollMs: opts.pollMs ?? CONFIRM_POLL_MS,
          timeoutMs: callOpts?.timeoutMs ?? opts.timeoutMs ?? CONFIRM_TIMEOUT_MS,
        },
      );
    },
  };
}
