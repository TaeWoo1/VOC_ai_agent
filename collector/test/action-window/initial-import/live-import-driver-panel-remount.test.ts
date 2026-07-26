/**
 * **The panel has to survive the navigation the run itself asked for.**
 *
 * Measured on 2026-07-26, live. The surface probe reported `LOGIN_REQUIRED`, the panel said so in the seller's page
 * and offered 다시 확인, and the operator logged into NAVER — which navigated the page and erased every injected
 * node, the instruction and the recovery control with it. The run was parked waiting to be asked to look again, so
 * no new state was published, so nothing re-drew the panel. The operator was left on a logged-in page with no way
 * forward and no explanation: the exact failure the in-page panel exists to prevent, caused by the panel's own
 * instruction being followed.
 *
 * Re-mounting the LAST state is the correct repair rather than a convenient one: the panel is a projection of run
 * state, the run state did not change across the navigation, so the panel afterwards must say what it said before.
 *
 * Offline: the page and its context are fakes, and `guidance-panel` is mocked so mounts are countable. No browser.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mountGuidancePanel = vi.fn(async (_ctx: unknown, _state: unknown) => {});
const unmountGuidancePanel = vi.fn(async (_ctx: unknown) => {});
const takeGuidanceIntent = vi.fn(async (_ctx: unknown) => null);

vi.mock("../../../src/action-window/guidance-panel", () => ({
  mountGuidancePanel: (ctx: unknown, state: unknown) => mountGuidancePanel(ctx, state),
  unmountGuidancePanel: (ctx: unknown) => unmountGuidancePanel(ctx),
  takeGuidanceIntent: (ctx: unknown) => takeGuidanceIntent(ctx),
  guidancePanelMounted: async () => true,
  GUIDANCE_PANEL_ID: "__aw_guidance_panel__",
  GUIDANCE_INTENT_KEY: "__aw_guidance_intent__",
}));

const { NaverLiveImportDriver } = await import("../../../src/action-window/initial-import/naver-live-import-driver");
type ImportDriver = InstanceType<typeof NaverLiveImportDriver>;

const PANEL = {
  product: "SellerOps",
  stepLine: "",
  instruction: "LOG-IN-PLEASE",
  requiredRange: "",
  blocked: { label: "STOPPED", title: "LOGIN-NEEDED", fix: "LOG-IN" },
  completion: null,
  actions: [{ command: "REQUEST_STEP_RECHECK", label: "LOOK-AGAIN" }],
};

/** A composed driver stubbed down to what the panel path touches: a context to evaluate in, and a page to listen on. */
function build() {
  const loadHandlers: Array<() => void> = [];
  const ctx = { evaluate: vi.fn(async () => undefined) };
  const page = {
    on: (event: string, cb: () => void) => {
      if (event === "load") loadHandlers.push(cb);
    },
  };
  const proven = {
    surfaceContext: () => ctx,
    surfacePage: () => page,
  };
  const driver = new NaverLiveImportDriver(proven as never, { guidanceEnabled: true }) as ImportDriver;
  return {
    driver,
    /** The page finished loading — a login, a redirect, an SPA route that really navigated. */
    navigate: async () => {
      for (const cb of [...loadHandlers]) cb();
      // The re-mount is fire-and-forget inside the handler; let its microtasks run.
      await new Promise((r) => setTimeout(r, 0));
    },
    loadListeners: () => loadHandlers.length,
  };
}

beforeEach(() => {
  mountGuidancePanel.mockClear();
  unmountGuidancePanel.mockClear();
});

describe("the guidance panel survives a navigation", () => {
  it("re-draws the last state after the page loads again", async () => {
    const h = build();
    await h.driver.renderGuidance(PANEL as never);
    expect(mountGuidancePanel).toHaveBeenCalledTimes(1);

    await h.navigate();

    expect(mountGuidancePanel).toHaveBeenCalledTimes(2);
    // The SAME words, because the run state did not change across the navigation.
    expect(mountGuidancePanel.mock.calls[1]![1]).toEqual(PANEL);
  });

  /** The blocked state is the one that matters: it asks for the very login that erases it. */
  it("keeps the recovery control on screen through the login it asked for", async () => {
    const h = build();
    await h.driver.renderGuidance(PANEL as never);
    await h.navigate();
    const redrawn = mountGuidancePanel.mock.calls[1]![1] as typeof PANEL;
    expect(redrawn.blocked).not.toBeNull();
    expect(redrawn.actions).toEqual([{ command: "REQUEST_STEP_RECHECK", label: "LOOK-AGAIN" }]);
  });

  /** A panel taken down deliberately stays down — a navigation must not resurrect a finished run's instructions. */
  it("re-draws nothing after the panel was removed on purpose", async () => {
    const h = build();
    await h.driver.renderGuidance(PANEL as never);
    await h.driver.renderGuidance(null);
    expect(unmountGuidancePanel).toHaveBeenCalledTimes(1);
    mountGuidancePanel.mockClear();

    await h.navigate();
    expect(mountGuidancePanel).not.toHaveBeenCalled();
  });

  it("re-draws the newest state, not the first one", async () => {
    const h = build();
    await h.driver.renderGuidance(PANEL as never);
    const later = { ...PANEL, instruction: "PICK-START", blocked: null };
    await h.driver.renderGuidance(later as never);

    await h.navigate();

    const last = mountGuidancePanel.mock.calls[mountGuidancePanel.mock.calls.length - 1]!;
    expect((last[1] as typeof PANEL).instruction).toBe("PICK-START");
  });

  /** One listener however many times a panel is drawn — otherwise every render adds another re-mount. */
  it("registers a single load listener across many renders", async () => {
    const h = build();
    for (let i = 0; i < 5; i += 1) await h.driver.renderGuidance(PANEL as never);
    expect(h.loadListeners()).toBe(1);

    mountGuidancePanel.mockClear();
    await h.navigate();
    expect(mountGuidancePanel).toHaveBeenCalledTimes(1);
  });

  /** Nothing is drawn before there is anything to draw, so a navigation on an idle agent mounts nothing. */
  it("adds no listener until a panel has been drawn", async () => {
    const h = build();
    expect(h.loadListeners()).toBe(0);
  });
});
