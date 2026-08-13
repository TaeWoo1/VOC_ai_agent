/**
 * **The shared confirmation host — driven, not read.**
 *
 * The guarantees below used to be inlined in one CLI and pinned by matching its source text. They are now one
 * implementation that every live CLI calls, so they are exercised here over a fake context: a page that records
 * what was evaluated on it, a context that hands out tabs, and an operator who presses (or does not).
 *
 * Each of these is a live defect, not a hypothetical:
 *  - the driver measuring the blank confirmation tab, because `activePage()` takes the NEWEST one;
 *  - the arm script painting itself onto a marketplace page the operator navigated the confirm tab to;
 *  - the operator unable to find the window the surface was in, and the OS raising a THIRD one instead.
 */
import { describe, expect, it } from "vitest";

import {
  OPERATOR_CONFIRM_BUTTON_LABEL,
  OPERATOR_CONFIRM_PAGE_TITLE,
  OPERATOR_UI_CONFIRMED,
} from "../../src/cli/operator-confirm";
import {
  CONFIRM_SURFACE_URL,
  attachOperatorConfirmTab,
  confirmTailLines,
  printOperatorAsk,
  withConfirmTail,
  type ConfirmHostContext,
  type ConfirmHostPage,
} from "../../src/cli/operator-confirm-host";

const ASK = { title: "STEP 2/3", headline: "reach the screen yourself.", lines: ["one", "two"] } as const;

/** A tab. `press()` is the only way a confirmation event comes into existence, exactly as in the real page. */
class FakePage implements ConfirmHostPage {
  scripts: string[] = [];
  raised = 0;
  private navigated: string | null = null;
  private armedToken: string | null = null;
  private event: unknown = null;
  /** Set by a test to make this tab refuse to evaluate at all (a closed page, a dead browser). */
  dead = false;

  url(): string {
    return this.navigated ?? CONFIRM_SURFACE_URL;
  }
  navigateTo(url: string): void {
    this.navigated = url;
  }
  async bringToFront(): Promise<void> {
    this.raised += 1;
  }
  /** A real human press: it carries whatever token is armed RIGHT NOW, and it is trusted. */
  press(choice: "primary" | "secondary" = "primary"): void {
    if (this.armedToken !== null) this.event = { token: this.armedToken, trusted: true, choice };
  }
  /** What a dispatched `click()` produces instead — the same token, `isTrusted` false. */
  pressUntrusted(): void {
    if (this.armedToken !== null) this.event = { token: this.armedToken, trusted: false };
  }
  /** The token this tab currently holds, so a test can see whether a second wait re-minted it. */
  armed(): string | null {
    return this.armedToken;
  }

  async evaluate<T>(script: string): Promise<T> {
    if (this.dead) throw new Error("Target page, context or browser has been closed");
    this.scripts.push(script);
    if (script.includes("(arm)")) {
      this.armedToken = /var TOKEN = "([0-9a-f]{32})"/.exec(script)?.[1] ?? null;
      this.event = null; // arming clears any earlier press, like the real script
      return true as unknown as T;
    }
    if (script.includes("(clear)")) {
      this.event = null;
      return true as unknown as T;
    }
    return this.event as T;
  }
}

class FakeContext implements ConfirmHostContext {
  readonly opened: FakePage[] = [];
  constructor(existing: FakePage[] = []) {
    this.opened.push(...existing);
  }
  pages(): ConfirmHostPage[] {
    return [...this.opened];
  }
  async newPage(): Promise<ConfirmHostPage> {
    const p = new FakePage();
    this.opened.push(p);
    return p;
  }
  on(): void {}
}

/** Attach a host whose waits are fast, and hand back the fake tabs so a test can press one. */
async function hostOn(
  ctx: FakeContext,
  o: { aborted?: () => boolean; timeoutMs?: number } = {},
): Promise<{ host: Awaited<ReturnType<typeof attachOperatorConfirmTab>>; confirmTab: FakePage; printed: string[] }> {
  const printed: string[] = [];
  const host = await attachOperatorConfirmTab(ctx, {
    aborted: o.aborted ?? (() => false),
    abortPath: "/tmp/x/run.abort",
    pollMs: 1,
    timeoutMs: o.timeoutMs ?? 30,
    print: (l) => printed.push(l),
  });
  const confirmTab = ctx.opened[ctx.opened.length - 1] as FakePage;
  return { host, confirmTab, printed };
}

describe("the confirmation tab the host owns", () => {
  it("**opens its own tab and leaves the operator's page as the entry page**", async () => {
    const sellerTab = new FakePage();
    const ctx = new FakeContext([sellerTab]);
    const { host, confirmTab } = await hostOn(ctx);
    expect(host.entryPage).toBe(sellerTab);
    expect(confirmTab).not.toBe(sellerTab);
    expect(ctx.opened).toHaveLength(2);
  });

  it("**the run's context excludes it** — nothing the run measures can land on the blank surface", async () => {
    const sellerTab = new FakePage();
    const ctx = new FakeContext([sellerTab]);
    const { host, confirmTab } = await hostOn(ctx);
    expect(host.contextLike.pages()).toEqual([sellerTab]);
    expect(host.contextLike.pages()).not.toContain(confirmTab);
    // …and it keeps excluding it as the seller opens more tabs. A snapshot taken at attach time would not.
    const another = await ctx.newPage();
    expect(host.contextLike.pages()).toEqual([sellerTab, another]);
  });

  it("opens a tab even when the context has none", async () => {
    const ctx = new FakeContext([]);
    const { host } = await hostOn(ctx);
    expect(ctx.opened).toHaveLength(2);
    expect(host.entryPage).toBe(ctx.opened[0]);
  });

  it("evaluates ONLY on its own tab — the operator's page is never written to", async () => {
    const sellerTab = new FakePage();
    const ctx = new FakeContext([sellerTab]);
    const { host, confirmTab } = await hostOn(ctx);
    await host.confirm(ASK);
    expect(sellerTab.scripts).toEqual([]);
    expect(confirmTab.scripts.length).toBeGreaterThan(0);
  });
});

describe("a checkpoint advances on a press and on nothing else", () => {
  it("a trusted press returns ready, carrying the channel as its provenance", async () => {
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab } = await hostOn(ctx, { timeoutMs: 5_000 });
    const waiting = host.confirm(ASK);
    // The press can only happen after the surface is armed — which is the point: nothing outside this process
    // knows the token it has to carry.
    for (let i = 0; i < 2_000 && confirmTab.armed() === null; i++) await new Promise<void>((r) => setTimeout(r, 1));
    confirmTab.press();
    expect(await waiting).toEqual({ signal: "ready", provenance: OPERATOR_UI_CONFIRMED, choice: "primary" });
  });

  it("**nobody presses anything and the wait times out** — it never falls through", async () => {
    const ctx = new FakeContext([new FakePage()]);
    const { host } = await hostOn(ctx);
    expect(await host.confirm(ASK)).toEqual({ signal: "timeout", provenance: null });
  });

  it("**a dispatched click is refused** — `isTrusted` is what a human press has and a script does not", async () => {
    const ctx = new FakeContext([new FakePage()]);
    const verdicts: string[] = [];
    const host = await attachOperatorConfirmTab(ctx, {
      aborted: () => false,
      pollMs: 1,
      timeoutMs: 30,
      onVerdict: (v) => verdicts.push(v),
      print: () => undefined,
    });
    const confirmTab = ctx.opened[1] as FakePage;
    const waiting = host.confirm(ASK);
    for (let i = 0; i < 2_000 && confirmTab.armed() === null; i++) await new Promise<void>((r) => setTimeout(r, 1));
    confirmTab.pressUntrusted();
    expect((await waiting).signal).toBe("timeout");
    expect(verdicts).toContain("UNTRUSTED_EVENT");
  });

  it("**a press held over from the previous checkpoint cannot advance this one**", async () => {
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab } = await hostOn(ctx, { timeoutMs: 5_000 });
    const first = host.confirm(ASK);
    for (let i = 0; i < 2_000 && confirmTab.armed() === null; i++) await new Promise<void>((r) => setTimeout(r, 1));
    const firstToken = confirmTab.armed();
    confirmTab.press();
    expect((await first).signal).toBe("ready");
    // A FRESH token per wait. The re-arm also clears the page's event, so the press above is gone twice over.
    const second = await Promise.race([
      host.confirm(ASK),
      new Promise((r) => setTimeout(() => r("still-waiting"), 200)),
    ]);
    expect(second).toBe("still-waiting");
    expect(confirmTab.armed()).not.toBe(firstToken);
  });

  it("an abort wins over everything, and is checked before the surface is even armed", async () => {
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab } = await hostOn(ctx, { aborted: () => true });
    expect(await host.confirm(ASK)).toEqual({ signal: "abort", provenance: null });
    expect(confirmTab.scripts).toEqual([]);
  });
});

describe("an ask with a SECOND answer", () => {
  const SKIPPABLE = { ...ASK, secondary: { label: "이 단계 건너뛰기" } };

  it("renders the second button only when the ask offers one", async () => {
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab } = await hostOn(ctx);
    await host.confirm(ASK);
    expect(confirmTab.scripts.find((s) => s.includes("(arm)"))).toContain('var SECONDARY = null');
    await host.confirm(SKIPPABLE);
    const armed = confirmTab.scripts.filter((s) => s.includes("(arm)"));
    expect(armed[armed.length - 1]).toContain("이 단계 건너뛰기");
  });

  it("**the second press is verified exactly like the first, and reports itself as the second**", async () => {
    // Skipping an optional stage is still an ADVANCE, so it goes through the same token + trusted-press check
    // rather than through a file beside it. What differs is only WHICH answer it is.
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab } = await hostOn(ctx, { timeoutMs: 5_000 });
    const waiting = host.confirm(SKIPPABLE);
    for (let i = 0; i < 2_000 && confirmTab.armed() === null; i++) await new Promise<void>((r) => setTimeout(r, 1));
    confirmTab.press("secondary");
    expect(await waiting).toEqual({ signal: "ready", provenance: OPERATOR_UI_CONFIRMED, choice: "secondary" });
  });

  it("an event with no choice at all reads as the PRIMARY answer, never the second", async () => {
    // Fail toward the narrower answer: a surface with one button produces no `choice`, and an unrecognised
    // value must not become "skip this stage".
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab } = await hostOn(ctx, { timeoutMs: 5_000 });
    const waiting = host.confirm(SKIPPABLE);
    for (let i = 0; i < 2_000 && confirmTab.armed() === null; i++) await new Promise<void>((r) => setTimeout(r, 1));
    confirmTab.press("bogus" as "primary");
    expect((await waiting)).toMatchObject({ signal: "ready", choice: "primary" });
  });
});

describe("the surface is pinned to the document it opened on", () => {
  it("**a tab the operator navigated is refused, never painted on**", async () => {
    // The arm script is self-mounting. The first arming raises the tab at exactly the moment the ask says "log
    // in and navigate yourself", which is when someone would type a URL into it — and arming after that would
    // restyle a live marketplace page and rewrite its title.
    const ctx = new FakeContext([new FakePage()]);
    const verdicts: string[] = [];
    const host = await attachOperatorConfirmTab(ctx, {
      aborted: () => false,
      pollMs: 1,
      timeoutMs: 30,
      onVerdict: (v) => verdicts.push(v),
      print: () => undefined,
    });
    const confirmTab = ctx.opened[1] as FakePage;
    confirmTab.navigateTo("https://wing.coupang.com/vendor/open-api");
    expect(await host.confirm(ASK)).toEqual({ signal: "timeout", provenance: null });
    expect(verdicts).toEqual(["UI_NOT_ARMED"]);
    expect(confirmTab.scripts).toEqual([]); // nothing was evaluated on the marketplace page
  });

  it("a surface that cannot be armed at all fails the wait CLOSED", async () => {
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab } = await hostOn(ctx);
    confirmTab.dead = true;
    expect(await host.confirm(ASK)).toEqual({ signal: "timeout", provenance: null });
  });
});

describe("the run raises its own surface", () => {
  it("**raises the tab once the ask is armed, and not before**", async () => {
    // Raising it from the OS instead (`open -a`) routes into Chrome's user-data-dir singleton and opens a THIRD
    // blank window inside the run's own browser — which the run would then measure as its newest tab. And
    // raising BEFORE arming would put the previous checkpoint's instruction in front of the operator at the
    // moment they are deciding.
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab } = await hostOn(ctx);
    expect(confirmTab.raised).toBe(0);
    await host.confirm(ASK);
    expect(confirmTab.raised).toBe(1);
  });

  it("a tab that will not come to the front does not end a run that is otherwise ready", async () => {
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab } = await hostOn(ctx, { timeoutMs: 5_000 });
    // Synchronous, which a `.catch` on a returned promise would not have caught.
    confirmTab.bringToFront = (): Promise<void> => {
      throw new Error("no such window");
    };
    const waiting = host.confirm(ASK);
    for (let i = 0; i < 2_000 && confirmTab.armed() === null; i++) await new Promise<void>((r) => setTimeout(r, 1));
    confirmTab.press();
    expect((await waiting).signal).toBe("ready");
  });
});

describe("the operator reads one set of words", () => {
  it("every ask carries the tail that says what advances it — and what does not", async () => {
    const ask = withConfirmTail(ASK, "/tmp/x/run.abort");
    const all = ask.lines.join("\n");
    expect(all).toContain(OPERATOR_CONFIRM_BUTTON_LABEL);
    expect(all).toContain(OPERATOR_CONFIRM_PAGE_TITLE);
    expect(all).toContain("대화창에 'ready'라고 쓰거나");
    expect(all).toContain("/tmp/x/run.abort");
    // The ask's own words survive it.
    expect(ask.title).toBe(ASK.title);
    expect(ask.lines.slice(0, 2)).toEqual(["one", "two"]);
  });

  it("a run with no abort file still tells the operator how to stop", () => {
    expect(confirmTailLines().join("\n")).toContain("Ctrl+C");
    expect(confirmTailLines().join("\n")).not.toContain("파일을 만드세요");
  });

  it("**the terminal and the surface are handed the same ask**", async () => {
    const ctx = new FakeContext([new FakePage()]);
    const { host, confirmTab, printed } = await hostOn(ctx);
    host.announce(ASK);
    await host.confirm(ASK);
    const armScript = confirmTab.scripts.find((s) => s.includes("(arm)")) ?? "";
    for (const line of [...ASK.lines, ...confirmTailLines("/tmp/x/run.abort")]) {
      expect(printed.join("\n"), line).toContain(line);
      expect(armScript, line).toContain(JSON.stringify(line).slice(1, -1));
    }
  });

  it("printing an ask writes the title, the headline and every line", () => {
    const printed: string[] = [];
    printOperatorAsk(ASK, (l) => printed.push(l));
    expect(printed.join("\n")).toContain(`${ASK.title} — ${ASK.headline}`);
    expect(printed.join("\n")).toContain("one");
  });
});
