/**
 * **Step ⑥ finishes itself once the vendor form reads complete.**
 *
 * The seller selects 자체개발(직접입력), types 업체명 and URL, presses 추가 — and then had to tell SellerOps they
 * had, on a panel whose own reading already knew. The census that refuses a premature press (see
 * `coupang-wing-vendor-form-gate.test.ts`) is the same one that answers this; nothing new is read.
 *
 * What this file pins is the shape of that advance: it needs a READY reading AND the step's own screen, it never
 * fires on `UNKNOWN`, the seller's own button is untouched, and the census the poll now takes once a second does
 * not flood the log.
 *
 * Driven over a fake page, like the gate suite it extends. A "filled field" is a count here exactly as it is on
 * WING — no value crosses the boundary in either place.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import { WING_VENDOR_METHOD_SCREEN_MARKER_SPECS } from "../../../src/action-window/coupang-wing-label-recon";
import { clearLogSink, getLogSink } from "../../../src/log";

const FIELD_IDS = ["stage2.vendor_info.baseline", "stage2.vendor_url.url", "stage2.call_ip.ip_addr"] as const;

class FakeVendorPage {
  pressed = false;
  /** Whether the vendor-method markers paint — i.e. whether this IS the screen step ⑥ is about. */
  onVendorScreen = true;
  filled = new Set<string>();
  censusReads = 0;
  /** Every in-page script the driver ran, so the keep-clear marking can be inspected. */
  scripts: string[] = [];
  /** Every overlay mount, as the panel options the driver handed the page. */
  mounts: { label?: string; docked?: boolean }[] = [];

  url(): string {
    return "https://wing.coupang.com/vendor/open-api";
  }
  on(): void {}

  async evaluate(script: unknown, arg?: unknown): Promise<unknown> {
    if (typeof script === "string") {
      this.scripts.push(script);
      if (script.includes("wing-field-region-census")) {
        this.censusReads += 1;
        return {
          readings: FIELD_IDS.map((id) => ({
            id,
            visibleCount: 1,
            hiddenCount: 0,
            observedTag: "DT",
            association: "DT_NEXT_DD",
            regionTag: "DD",
            inputCount: 1,
            textInputCount: 1,
            buttonCount: id === "stage2.call_ip.ip_addr" ? 1 : 0,
            entryRowCount: id === "stage2.call_ip.ip_addr" && this.filled.has(id) ? 1 : 0,
            filledTextInputCount: id !== "stage2.call_ip.ip_addr" && this.filled.has(id) ? 1 : 0,
          })),
        };
      }
      if (script.includes("issuance-avoid-tag")) return { marked: 0 };
      // The two shapes a step's own locate takes, so the mount is actually reached: a promoted step resolves a
      // ring PLAN, a fixed-label step resolves one label.
      if (script.includes("issuance-ring-plan-")) return { resolved: true, rows: [{ count: 1, sig: "abcdef0123456789", tag: "LABEL" }] };
      if (script.includes("API Key 발급 받기")) return { count: 1, sig: "abcdef0123456789", hiddenCount: 0, tag: "BUTTON" };
      const painting = this.onVendorScreen && WING_VENDOR_METHOD_SCREEN_MARKER_SPECS.some((s) => script.includes(s.exactText));
      return painting ? { count: 1, sig: "abcdef0123456789", hiddenCount: 0 } : { count: 0, hiddenCount: 0 };
    }
    if (arg !== undefined) {
      if (typeof arg === "string") {
        if (String(script).includes("delete")) {
          this.pressed = false;
          return undefined;
        }
        if (String(script).includes("press_count")) {
          return { presses: this.pressed ? 1 : 0, latched: this.pressed, tokenArmed: true, panelMounted: true };
        }
        return this.pressed;
      }
      const opts = arg as Record<string, unknown>;
      if (typeof opts["label"] === "string") {
        this.mounts.push({ label: opts["label"] as string, docked: opts["dockedPanelOnly"] === true });
        return undefined;
      }
      return this.pressed;
    }
    return true;
  }
}

function driverOn(page: FakeVendorPage, observeTimeoutMs = 400): CoupangWingIssuanceDriver {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CoupangWingIssuanceDriver(page as any, { observeTimeoutMs });
}

const rows = (event: string) => getLogSink().filter((l) => l.event === event);

beforeEach(() => clearLogSink());

describe("step ⑥ completes itself on the form the seller is filling in", () => {
  it("**advances with NO press once 업체명 · URL are typed and the IP is ADDED**", async () => {
    const page = new FakeVendorPage();
    page.filled = new Set(FIELD_IDS);
    expect(page.pressed).toBe(false);
    expect(await driverOn(page).observeUserAction("vendor_method")).toBe(true);
    expect(rows("aw_coupang_vendor_form_auto_advance").length).toBe(1);
  });

  it("waits while the form is incomplete — the walk does not run ahead of the seller", async () => {
    const page = new FakeVendorPage();
    page.filled = new Set(["stage2.vendor_info.baseline", "stage2.vendor_url.url"]); // the IP was never 추가'd
    expect(await driverOn(page).observeUserAction("vendor_method")).toBe(false);
    expect(rows("aw_coupang_vendor_form_auto_advance").length).toBe(0);
  });

  it("**`UNKNOWN` never advances it** — a reading it could not take decides nothing about the seller", async () => {
    // The mirror of the gate's rule, and the same reason: only the LABELS on this screen have ever been
    // measured. There it must not HOLD the seller on a census it could not resolve; here it must not MOVE them.
    const page = new FakeVendorPage();
    page.filled = new Set(FIELD_IDS);
    const base = FakeVendorPage.prototype.evaluate;
    page.evaluate = async (script: unknown, arg?: unknown): Promise<unknown> => {
      if (typeof script === "string" && script.includes("wing-field-region-census")) {
        return { readings: FIELD_IDS.map((id) => ({ id, visibleCount: 0, hiddenCount: 2 })) };
      }
      return base.call(page, script, arg);
    };
    expect(await driverOn(page).observeUserAction("vendor_method")).toBe(false);
  });

  it("**a ready-looking form on the WRONG screen does not advance it**", async () => {
    // 업체명 / URL also paint in the 연동 정보 block on the issued screen — measured 2026-08-13, and it is why
    // the ⑧ ring encloses more than the keys. A readiness reading taken there is not this screen's form.
    const page = new FakeVendorPage();
    page.filled = new Set(FIELD_IDS);
    page.onVendorScreen = false;
    expect(await driverOn(page).observeUserAction("vendor_method")).toBe(false);
  });

  it("the seller's own button still advances the step, form or no form", async () => {
    const page = new FakeVendorPage();
    page.filled = new Set(FIELD_IDS);
    page.pressed = true;
    expect(await driverOn(page).observeUserAction("vendor_method")).toBe(true);
  });

  it("**no other step polls the form** — the census belongs to this one", async () => {
    for (const target of ["issue", "confirm_purpose", "issue_final", "credentials"] as const) {
      const page = new FakeVendorPage();
      page.pressed = true;
      expect(await driverOn(page).observeUserAction(target), target).toBe(true);
      expect(page.censusReads, target).toBe(0);
    }
  });

  it("the polled census is SAMPLED, not repeated once a second", async () => {
    // It used to be read once per press. A step that watches the seller fill a form in reads it for as long as
    // that takes, and three lines a second would bury the transition that is the only thing anyone reads it for.
    const page = new FakeVendorPage();
    page.filled = new Set(["stage2.vendor_info.baseline"]);
    await driverOn(page, 3_000).observeUserAction("vendor_method");
    expect(page.censusReads).toBeGreaterThan(2);
    // Three fields, one line each on the first reading; the identical repeats are sampled after that.
    expect(rows("aw_coupang_vendor_form_field").length).toBeLessThan(page.censusReads * 3);
  });

  it("what it logs is an id and booleans — never what the seller typed", async () => {
    const page = new FakeVendorPage();
    page.filled = new Set(FIELD_IDS);
    await driverOn(page).observeUserAction("vendor_method");
    for (const row of rows("aw_coupang_vendor_form_field")) {
      for (const key of Object.keys(row.meta ?? {})) {
        expect(
          ["fieldId", "ready", "resolved", "visibleCount", "repeat", "regionTag", "inputCount", "textInputCount", "buttonCount", "entryRowCount"],
          key,
        ).toContain(key);
      }
    }
    const advance = rows("aw_coupang_vendor_form_auto_advance")[0];
    expect(Object.keys(advance?.meta ?? {})).toEqual(["target"]);
  });
});

describe("the ⑥ ring comes down once the seller has chosen the method", () => {
  it("**retires the ring and re-briefs the panel** when the form is on screen", async () => {
    // Reported by the operator on 2026-08-13, watching the ring sit on a radio they had already set while the
    // work moved to the fields below it: "입력해야 하는 턴은 ring을 없애든지 입력 박스 전체를 감싸든지".
    const page = new FakeVendorPage();
    await driverOn(page).observeUserAction("vendor_method");
    expect(rows("aw_coupang_step_ring_retired").length).toBeGreaterThan(0);
    const docked = page.mounts.find((m) => m.docked === true);
    expect(docked, "the panel was not re-mounted docked").toBeDefined();
    expect(docked?.label).toContain("입력 방식은 선택되었습니다");
  });

  it("retires it ONCE, not on every poll", async () => {
    const page = new FakeVendorPage();
    await driverOn(page, 3_000).observeUserAction("vendor_method");
    expect(rows("aw_coupang_step_ring_retired").length).toBe(1);
  });

  it("**keeps the ring while the form is not on screen** — `UNKNOWN` is not a selection", async () => {
    // The signal is the form REVEAL, never the radio's `checked`: SellerOps does not claim to know which option
    // is selected. A census that cannot resolve the three labels says nothing about what the seller chose.
    const page = new FakeVendorPage();
    const base = FakeVendorPage.prototype.evaluate;
    page.evaluate = async (script: unknown, arg?: unknown): Promise<unknown> => {
      if (typeof script === "string" && script.includes("wing-field-region-census")) {
        return { readings: FIELD_IDS.map((id) => ({ id, visibleCount: 0, hiddenCount: 1 })) };
      }
      return base.call(page, script, arg);
    };
    await driverOn(page).observeUserAction("vendor_method");
    expect(rows("aw_coupang_step_ring_retired").length).toBe(0);
    expect(page.mounts.some((m) => m.docked === true)).toBe(false);
  });

  it("**puts it back if the form leaves the screen** — the decision is re-made from a live reading", async () => {
    const page = new FakeVendorPage();
    let revealed = true;
    const base = FakeVendorPage.prototype.evaluate;
    page.evaluate = async (script: unknown, arg?: unknown): Promise<unknown> => {
      if (typeof script === "string" && script.includes("wing-field-region-census") && !revealed) {
        return { readings: FIELD_IDS.map((id) => ({ id, visibleCount: 0, hiddenCount: 1 })) };
      }
      return base.call(page, script, arg);
    };
    const driver = driverOn(page, 4_000);
    const observing = driver.observeUserAction("vendor_method");
    for (let i = 0; i < 2_000 && rows("aw_coupang_step_ring_retired").length === 0; i++) {
      await new Promise<void>((r) => setTimeout(r, 1));
    }
    revealed = false; // the seller went back; the form is no longer painting
    await observing;
    expect(rows("aw_coupang_step_ring_restored").length).toBe(1);
  });
});

describe("the panel's keep-clear marks are written per step", () => {
  it("**step ⑥ declares the form and the 확인 below it** — the controls the seller uses next", async () => {
    const page = new FakeVendorPage();
    page.filled = new Set(FIELD_IDS);
    await driverOn(page).highlightTarget("vendor_method");
    const script = page.scripts.find((s) => s.includes("issuance-avoid-tag"));
    expect(script, "step ⑥ mounted without declaring anything to keep clear of").toBeDefined();
    for (const label of ["업체명", "URL", "IP 주소", "확인"]) expect(script).toContain(label);
  });

  it("a step with nothing to avoid still runs the marking — that is how the previous step's marks go away", async () => {
    const page = new FakeVendorPage();
    await driverOn(page).highlightTarget("issue");
    const script = page.scripts.find((s) => s.includes("issuance-avoid-tag"));
    expect(script).toBeDefined();
    expect(script).toContain("removeAttribute('data-aw-avoid')");
    expect(script).not.toContain("업체명");
  });
});
