// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VocItemTriageControl } from "./VocItemTriageControl";
import { api } from "../lib/apiClient";
import type { TriageDecisionResponse, TriageDisposition } from "../lib/types";

// The write half of the drill-down. The API client is mocked at its boundary — what this
// owns is what the operator sees and what the server is ASKED, not how axios works.
//
// jsdom does not apply Tailwind, so state is asserted through roles/aria and text, never
// through styling — which is the right assertion anyway: `aria-pressed` is what conveys
// the current choice to a screen reader; a background colour conveys nothing.

const ACTION_REF = "review:6f1c8b1e-0000-4000-8000-000000000001";

function renderControl(disposition: TriageDisposition | null = null) {
  render(
    <VocItemTriageControl accountId="acct-1" actionRef={ACTION_REF} disposition={disposition} />,
  );
}

function option(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

/** The current choice, per aria — not per styling. */
function current(): string | null {
  const on = screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") === "true");
  return on?.textContent?.replace("…", "") ?? null;
}

/**
 * Inert per ARIA, not per the native attribute.
 *
 * The distinction is the whole point of the control's semantics: `disabled` would take the
 * button out of the focus order, which is the bug this shape exists to avoid. So the tests
 * must assert `aria-disabled` — asserting `toBeDisabled()` would pass only for the
 * implementation that loses focus.
 */
function inert(el: HTMLElement): boolean {
  return el.getAttribute("aria-disabled") === "true";
}

/** A promise the test releases by hand, so "in flight" is exact rather than a timing guess. */
function deferred() {
  let release!: (v: TriageDecisionResponse) => void;
  const promise = new Promise<TriageDecisionResponse>((res) => {
    release = res;
  });
  return { promise, release: (v: TriageDecisionResponse) => release(v) };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VocItemTriageControl", () => {
  it.each([
    ["대응 필요", "RESPONSE_NEEDED"],
    ["지켜보기", "MONITOR"],
    ["조치 불필요", "NO_ACTION"],
  ])("records %s as %s and shows it only after the server confirms", async (label, value) => {
    const spy = vi.spyOn(api, "recordVocItemTriage").mockResolvedValue({
      actionRef: ACTION_REF,
      disposition: value as TriageDisposition,
      replayed: false,
    });
    renderControl();

    await userEvent.click(option(label));

    await waitFor(() => expect(current()).toBe(label));
    // Every disposition reaches the wire as the enum NAME the backend contract defines —
    // the Korean label is this layer's, and must never travel.
    expect(spy).toHaveBeenCalledWith("acct-1", ACTION_REF, {
      commandId: expect.any(String),
      disposition: value,
    });
  });

  it("shows an unrecorded row as 판단 전, distinct from 조치 불필요", () => {
    renderControl(null);

    // The two absences must not collapse: nobody-decided is not the same fact as
    // someone-decided-nothing-is-needed, and this surface exists to tell them apart.
    expect(screen.getByText("판단 전")).toBeInTheDocument();
    expect(current()).toBeNull();
  });

  it("seeds from the row's already-recorded decision", () => {
    renderControl("MONITOR");
    expect(current()).toBe("지켜보기");
    expect(screen.queryByText("판단 전")).not.toBeInTheDocument();
  });

  it("reports the server's CURRENT decision, not the one that was asked for", async () => {
    // A replay of a command a later one superseded: the server answers with where things
    // actually stand. Rendering the requested value would show a decision that is not live.
    vi.spyOn(api, "recordVocItemTriage").mockResolvedValue({
      actionRef: ACTION_REF,
      disposition: "NO_ACTION",
      replayed: true,
    });
    renderControl();

    await userEvent.click(option("대응 필요"));

    await waitFor(() => expect(current()).toBe("조치 불필요"));
  });

  // --- focus survives a decision ---------------------------------------------

  it("keeps focus on the option the operator activated", async () => {
    // The reason these are aria-disabled and not `disabled`. Disabling the focused element
    // makes the browser blur it to <body>; on success it would stay disabled, so focus
    // would never come back — and in a 10-row list that costs a keyboard operator their
    // place on every single decision.
    vi.spyOn(api, "recordVocItemTriage").mockResolvedValue({
      actionRef: ACTION_REF,
      disposition: "MONITOR",
      replayed: false,
    });
    renderControl();

    const target = option("지켜보기");
    target.focus();
    await userEvent.click(target);
    await waitFor(() => expect(current()).toBe("지켜보기"));

    // Still focused AFTER the write settled and the option became the current choice.
    expect(document.activeElement).toBe(target);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("keeps the current choice focusable so a keyboard operator can move on", () => {
    renderControl("MONITOR");
    const currentOption = option("지켜보기");

    // Inert, but not removed from the focus order: it is the answer, not a dead control.
    expect(inert(currentOption)).toBe(true);
    expect(currentOption).not.toBeDisabled();
    currentOption.focus();
    expect(document.activeElement).toBe(currentOption);
  });

  it("keeps focus on a failed option so the retry is one keypress away", async () => {
    vi.spyOn(api, "recordVocItemTriage").mockRejectedValue(new Error("network"));
    renderControl();

    const target = option("대응 필요");
    target.focus();
    await userEvent.click(target);
    await screen.findByRole("alert");

    expect(document.activeElement).toBe(target);
  });

  // --- duplicate submission --------------------------------------------------

  it("mounts the polite status region before anything happens, and only its text changes", async () => {
    // A live region has to be in the accessibility tree BEFORE its content changes or AT
    // never registers on it — mounting the region and its text together is the classic way
    // to get silence. It matters more here than usual: the busy state has nowhere else to
    // go. The button's name is held stable on purpose, the ellipsis is aria-hidden, and
    // aria-busy on a focused button is not reliably announced.
    const { promise, release } = deferred();
    vi.spyOn(api, "recordVocItemTriage").mockReturnValue(promise);
    const { container } = render(
      <VocItemTriageControl accountId="acct-1" actionRef={ACTION_REF} disposition={null} />,
    );

    const region = container.querySelector('[aria-live="polite"]');
    // Present at rest, and empty — so it costs nothing visually and is already registered.
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();

    await userEvent.click(option("대응 필요"));

    // The SAME node now carries the text: an update to a registered region, not a new one.
    await waitFor(() => expect(region).toHaveTextContent("저장 중…"));
    expect(container.querySelector('[aria-live="polite"]')).toBe(region);

    release({ actionRef: ACTION_REF, disposition: "RESPONSE_NEEDED", replayed: false });
    await waitFor(() => expect(region).toBeEmptyDOMElement());
    // Still the same node, still mounted, ready for the next decision.
    expect(container.querySelector('[aria-live="polite"]')).toBe(region);
  });

  it("keeps each option's accessible name stable while it is saving", async () => {
    // The pending marker is decoration and must stay out of the accessible name. Appending
    // it — "대응 필요" → "대응 필요…" — renames the control mid-interaction, which a screen
    // reader announces as a different button and which makes the element unfindable by the
    // name it had a moment ago. aria-busy carries the state instead.
    const { promise, release } = deferred();
    vi.spyOn(api, "recordVocItemTriage").mockReturnValue(promise);
    renderControl();

    await userEvent.click(option("대응 필요"));
    await waitFor(() => expect(option("대응 필요")).toHaveAttribute("aria-busy", "true"));

    // Same name, before and during. Only the busy one is marked.
    expect(option("지켜보기")).toHaveAttribute("aria-busy", "false");
    release({ actionRef: ACTION_REF, disposition: "RESPONSE_NEEDED", replayed: false });
    await waitFor(() => expect(option("대응 필요")).toHaveAttribute("aria-busy", "false"));
  });

  it("marks every option inert while a write is in flight", async () => {
    const { promise, release } = deferred();
    vi.spyOn(api, "recordVocItemTriage").mockReturnValue(promise);
    renderControl();

    await userEvent.click(option("대응 필요"));
    await waitFor(() => expect(screen.getByText("저장 중…")).toBeInTheDocument());

    for (const button of screen.getAllByRole("button")) {
      expect(inert(button)).toBe(true);
    }

    release({ actionRef: ACTION_REF, disposition: "RESPONSE_NEEDED", replayed: false });
    await waitFor(() => expect(current()).toBe("대응 필요"));
  });

  it("sends nothing on a second click during flight, even though the button still takes clicks", async () => {
    // aria-disabled does NOT stop a click — that is the trade for keeping focus. So the
    // handler's own guard is the only thing between a double click and a double write,
    // and it has to be tested through a real click rather than assumed from the attribute.
    const { promise, release } = deferred();
    const spy = vi.spyOn(api, "recordVocItemTriage").mockReturnValue(promise);
    renderControl();

    await userEvent.click(option("대응 필요"));
    await userEvent.click(option("지켜보기"));
    await userEvent.click(option("대응 필요"));

    expect(spy).toHaveBeenCalledTimes(1);
    release({ actionRef: ACTION_REF, disposition: "RESPONSE_NEEDED", replayed: false });
    await waitFor(() => expect(current()).toBe("대응 필요"));
  });

  it("sends nothing on rapid synchronous clicks in a single tick", async () => {
    // The guard is a ref, not state, precisely for this: `pending` would not update until
    // the next render, so three clicks in one tick would all read `busy === false` and all
    // fire. Dispatched directly to bypass userEvent's per-click settling.
    const { promise, release } = deferred();
    const spy = vi.spyOn(api, "recordVocItemTriage").mockReturnValue(promise);
    renderControl();

    const target = option("조치 불필요");
    target.click();
    target.click();
    target.click();

    expect(spy).toHaveBeenCalledTimes(1);
    release({ actionRef: ACTION_REF, disposition: "NO_ACTION", replayed: false });
    await waitFor(() => expect(current()).toBe("조치 불필요"));
  });

  // --- the confirmed choice is inert ------------------------------------------

  it("does not re-submit the decision the server already holds", async () => {
    const spy = vi.spyOn(api, "recordVocItemTriage");
    renderControl("MONITOR");

    const currentOption = option("지켜보기");
    expect(inert(currentOption)).toBe(true);
    await userEvent.click(currentOption);

    // Re-sending would append an audit row for a transition from a value to itself —
    // noise in a trail whose whole job is to answer what changed and when.
    expect(spy).not.toHaveBeenCalled();
    expect(current()).toBe("지켜보기");
  });

  it("keeps the other options actionable while one is current", async () => {
    vi.spyOn(api, "recordVocItemTriage").mockResolvedValue({
      actionRef: ACTION_REF,
      disposition: "NO_ACTION",
      replayed: false,
    });
    renderControl("MONITOR");

    expect(option("지켜보기")).toHaveAttribute("aria-pressed", "true");
    expect(inert(option("대응 필요"))).toBe(false);
    expect(inert(option("조치 불필요"))).toBe(false);

    // ...and changing your mind still works.
    await userEvent.click(option("조치 불필요"));
    await waitFor(() => expect(current()).toBe("조치 불필요"));
    expect(inert(option("지켜보기"))).toBe(false);
  });

  // --- error + retry ---------------------------------------------------------

  it("preserves the prior decision on failure and announces a retryable error", async () => {
    vi.spyOn(api, "recordVocItemTriage").mockRejectedValue(new Error("network"));
    renderControl("MONITOR");

    await userEvent.click(option("대응 필요"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("저장하지 못했습니다");
    // The prior state stands. A silent flip to the requested value would tell the operator
    // a decision was recorded that the server never took.
    expect(current()).toBe("지켜보기");
    expect(inert(option("대응 필요"))).toBe(false);
  });

  it("leaks no server or network detail into the error", async () => {
    vi.spyOn(api, "recordVocItemTriage").mockRejectedValue(
      new Error("Request failed with status code 409 at http://localhost:8080/api/..."),
    );
    renderControl();

    await userEvent.click(option("지켜보기"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/409|http|localhost|api\/|Error/i);
  });

  // --- no secure randomness --------------------------------------------------

  it("reports a capability limit — not a retry — when no command id can be minted", async () => {
    // An insecure origin with no getRandomValues either. No id means no request, and no
    // number of retries can produce one, so telling the operator to try again would be a
    // lie that costs them clicks to disprove.
    vi.stubGlobal("crypto", {});
    const spy = vi.spyOn(api, "recordVocItemTriage");
    renderControl();

    await userEvent.click(option("대응 필요"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("이 환경에서는 처리 상태를 기록할 수 없습니다");
    // Distinct from the retryable failure, in the words the operator reads.
    expect(alert).not.toHaveTextContent("다시 시도해 주세요");
    // Nothing was attempted, and nothing is shown as decided.
    expect(spy).not.toHaveBeenCalled();
    expect(current()).toBeNull();
    expect(screen.queryByText("저장 중…")).not.toBeInTheDocument();
  });

  it("stays a no-op on every later click once the capability is known missing", async () => {
    // The buttons still receive clicks — that is the price of aria-disabled — so the
    // handler has to enforce what the attribute advertises. Without the guard, each click
    // re-mints, re-throws, and re-sets the same state: harmless only by accident.
    vi.stubGlobal("crypto", {});
    const spy = vi.spyOn(api, "recordVocItemTriage");
    renderControl();

    await userEvent.click(option("대응 필요"));
    await screen.findByRole("alert");
    await userEvent.click(option("지켜보기"));
    await userEvent.click(option("조치 불필요"));

    expect(spy).not.toHaveBeenCalled();
    expect(current()).toBeNull();
    // Exactly one alert, still the capability one — not a retry message.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("이 환경에서는 처리 상태를 기록할 수 없습니다");
  });

  // --- a 200 the client cannot trust -----------------------------------------

  it.each([
    ["an unknown disposition", { actionRef: ACTION_REF, disposition: "SOMETHING_NEW", replayed: false }],
    ["a missing disposition", { actionRef: ACTION_REF, replayed: false }],
    ["an empty body", undefined],
  ])("treats %s as a retryable failure rather than a decision", async (_case, body) => {
    // A 200 with a body the client cannot name is the worst kind of success: the value
    // would land in state and render as 판단 전 — no decision — so the operator concludes
    // their click did nothing. The TypeScript type is a claim about the code, not the bytes.
    vi.spyOn(api, "recordVocItemTriage").mockResolvedValue(body as never);
    renderControl("MONITOR");

    await userEvent.click(option("대응 필요"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("저장하지 못했습니다");
    // The prior decision stands — nothing about the response justified moving it.
    expect(current()).toBe("지켜보기");
    expect(inert(option("대응 필요"))).toBe(false);
  });

  it("retries an unreadable response with the SAME command id", async () => {
    // The write may well have landed — a 200 came back. So the retry has to be the same
    // command, which the server replays, rather than a second decision recorded on top.
    const spy = vi
      .spyOn(api, "recordVocItemTriage")
      .mockResolvedValueOnce({ actionRef: ACTION_REF, disposition: "???" } as never)
      .mockResolvedValueOnce({ actionRef: ACTION_REF, disposition: "RESPONSE_NEEDED", replayed: true });
    renderControl();

    await userEvent.click(option("대응 필요"));
    await screen.findByRole("alert");
    await userEvent.click(option("대응 필요"));
    await waitFor(() => expect(current()).toBe("대응 필요"));

    const [first, second] = spy.mock.calls;
    expect(second[2].commandId).toBe(first[2].commandId);
  });

  it("still works on an insecure origin that has getRandomValues", async () => {
    // The real LAN-origin shape: randomUUID is gone, getRandomValues is not. This is the
    // path that makes the control usable at all over plain http.
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    const spy = vi.spyOn(api, "recordVocItemTriage").mockResolvedValue({
      actionRef: ACTION_REF,
      disposition: "MONITOR",
      replayed: false,
    });
    renderControl();

    await userEvent.click(option("지켜보기"));

    await waitFor(() => expect(current()).toBe("지켜보기"));
    expect(spy.mock.calls[0][2].commandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  // --- command-id stability --------------------------------------------------

  it("reuses the command id when retrying the SAME decision", async () => {
    const spy = vi
      .spyOn(api, "recordVocItemTriage")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ actionRef: ACTION_REF, disposition: "RESPONSE_NEEDED", replayed: true });
    renderControl();

    await userEvent.click(option("대응 필요"));
    await screen.findByRole("alert");
    await userEvent.click(option("대응 필요"));
    await waitFor(() => expect(current()).toBe("대응 필요"));

    // The whole point of the key: a retry is the SAME decision arriving twice, which the
    // backend answers as a replay. A fresh id would make it a second, independent decision
    // and append a duplicate to the audit trail.
    expect(spy).toHaveBeenCalledTimes(2);
    const [first, second] = spy.mock.calls;
    expect(second[2].commandId).toBe(first[2].commandId);
  });

  it("mints a NEW command id when the operator changes their mind", async () => {
    const spy = vi
      .spyOn(api, "recordVocItemTriage")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ actionRef: ACTION_REF, disposition: "MONITOR", replayed: false });
    renderControl();

    await userEvent.click(option("대응 필요"));
    await screen.findByRole("alert");
    await userEvent.click(option("지켜보기"));
    await waitFor(() => expect(current()).toBe("지켜보기"));

    // A different disposition is a different intent. Reusing the id would be a 409 — the
    // backend refuses one command id spent on two decisions.
    const [first, second] = spy.mock.calls;
    expect(second[2].commandId).not.toBe(first[2].commandId);
  });

  it("mints a NEW id when switching away from a failed attempt and back again", async () => {
    // A→(fail)→B→(fail)→A. The third click is not a retry of the first: the operator asked
    // for B in between, so A is a fresh intent and reusing its old id would conflate two
    // decisions the trail should see separately.
    const spy = vi
      .spyOn(api, "recordVocItemTriage")
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ actionRef: ACTION_REF, disposition: "RESPONSE_NEEDED", replayed: false });
    renderControl();

    await userEvent.click(option("대응 필요"));
    await screen.findByRole("alert");
    await userEvent.click(option("지켜보기"));
    await screen.findByRole("alert");
    await userEvent.click(option("대응 필요"));
    await waitFor(() => expect(current()).toBe("대응 필요"));

    const [first, , third] = spy.mock.calls;
    expect(third[2].commandId).not.toBe(first[2].commandId);
  });

  // --- the ref is round-tripped, never parsed --------------------------------

  it("round-trips the opaque ref verbatim", async () => {
    const spy = vi
      .spyOn(api, "recordVocItemTriage")
      .mockResolvedValue({ actionRef: ACTION_REF, disposition: "MONITOR", replayed: false });
    renderControl();

    await userEvent.click(option("지켜보기"));

    // Handed back byte-for-byte: it is an address the server minted, and this layer has no
    // business interpreting or reshaping it.
    await waitFor(() => expect(spy.mock.calls[0][1]).toBe(ACTION_REF));
  });
});
