/**
 * The credential driver's refusals. The successful read is exercised against a real DOM in
 * `test/credential/credential-cell-inpage.test.ts`; what is tested here is everything the driver does when the
 * page answers something it should not act on — and the fact that it asks the page exactly once.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { clearLogSink, getLogSink } from "../../src/log";
import { CoupangWingCredentialDriver } from "../../src/action-window/coupang-wing-credential-driver";

const VENDOR = "V-00099";
const ACCESS = "8f2c1ab4d5e6f70819a2b3c4d5e6f708";
const SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";

/** A census answer the classifier reads as the issued open-API surface. */
const ISSUED_CENSUS = { openApiMarkerPresent: true, credentialAnchorPresent: true };
const LOGIN_CENSUS = { loginFormPresent: true, passwordFieldPresent: true };

interface FakePageInit {
  url?: string;
  /** Answers, in order, for each `evaluate` the driver makes. A script is matched by a fragment it contains. */
  answers: readonly { match: string; value: unknown }[];
}

class FakePage {
  readonly scripts: string[] = [];
  private readonly init: FakePageInit;

  constructor(init: FakePageInit) {
    this.init = init;
  }

  url(): string {
    return this.init.url ?? "https://wing.coupang.com/tenants/wing-open-api/open-api";
  }

  async evaluate(script: string): Promise<unknown> {
    this.scripts.push(script);
    const hit = this.init.answers.find((a) => script.includes(a.match));
    if (!hit) throw new Error("no canned answer for this script");
    if (hit.value instanceof Error) throw hit.value;
    return hit.value;
  }
}

function driverFor(init: FakePageInit): { driver: CoupangWingCredentialDriver; page: FakePage } {
  const page = new FakePage(init);
  return { driver: new CoupangWingCredentialDriver(page as unknown as Page), page };
}

/** How many times the driver asked the page for VALUES (as opposed to structure). */
function readCalls(page: FakePage): number {
  return page.scripts.filter((s) => s.includes("wing-credential-cell-read")).length;
}

beforeEach(() => clearLogSink());

describe("it will not read a screen that is not the issued one", () => {
  it("refuses on a login page, and never asks for a value", async () => {
    const { driver, page } = driverFor({
      url: "https://wing.coupang.com/login",
      answers: [{ match: "editableTypes", value: LOGIN_CENSUS }],
    });
    expect(await driver.readCredentialValues()).toMatchObject({ ok: false });
    expect(readCalls(page)).toBe(0);
  });

  it("re-classifies at the read rather than trusting an earlier check", async () => {
    // The seller pressed at a moment; the page can have moved since. What matters is the screen the value would
    // come from, so the surface check happens on THIS call.
    const { driver, page } = driverFor({
      url: "https://wing.coupang.com/tenants/wing-open-api/open-api",
      answers: [{ match: "editableTypes", value: ISSUED_CENSUS }, { match: "wing-credential-cell-read", value: { ok: false, reason: "CELL_EMPTY" } }],
    });
    await driver.readCredentialValues();
    expect(page.scripts.some((s) => s.includes("editableTypes"))).toBe(true);
  });
});

describe("one shot means one shot", () => {
  it("a second call is refused without touching the page", async () => {
    const { driver, page } = driverFor({
      answers: [
        { match: "editableTypes", value: ISSUED_CENSUS },
        { match: "wing-credential-cell-read", value: { ok: true, values: { vendor_id: VENDOR, access_key: ACCESS, secret_key: SECRET } } },
      ],
    });
    expect((await driver.readCredentialValues()).ok).toBe(true);
    const after = page.scripts.length;
    expect((await driver.readCredentialValues()).ok).toBe(false);
    expect(page.scripts.length).toBe(after);
  });

  it("a FAILED first read still burns the shot — a retry is a second copy of three secrets", async () => {
    const { driver } = driverFor({
      answers: [
        { match: "editableTypes", value: ISSUED_CENSUS },
        { match: "wing-credential-cell-read", value: { ok: false, reason: "CELL_NOT_UNIQUE" } },
      ],
    });
    expect((await driver.readCredentialValues()).ok).toBe(false);
    const second = await driver.readCredentialValues();
    expect(second).toMatchObject({ ok: false, reason: "MISSING_READING" });
  });
});

describe("the fold is total and fail-closed", () => {
  const cases: readonly { name: string; value: unknown }[] = [
    { name: "a bare true", value: true },
    { name: "null", value: null },
    { name: "ok with no values", value: { ok: true } },
    { name: "ok with a non-object values", value: { ok: true, values: "nope" } },
    { name: "ok missing one field", value: { ok: true, values: { vendor_id: VENDOR, access_key: ACCESS } } },
    { name: "ok with an empty field", value: { ok: true, values: { vendor_id: VENDOR, access_key: ACCESS, secret_key: "" } } },
    { name: "ok with a non-string field", value: { ok: true, values: { vendor_id: VENDOR, access_key: ACCESS, secret_key: 7 } } },
  ];

  for (const c of cases) {
    it(`refuses ${c.name}`, async () => {
      const { driver } = driverFor({
        answers: [{ match: "editableTypes", value: ISSUED_CENSUS }, { match: "wing-credential-cell-read", value: c.value }],
      });
      expect((await driver.readCredentialValues()).ok).toBe(false);
    });
  }

  it("a throwing evaluate is a refusal, and the thrown error is not inspected", async () => {
    const { driver } = driverFor({
      answers: [
        { match: "editableTypes", value: ISSUED_CENSUS },
        { match: "wing-credential-cell-read", value: new Error(`evaluate failed on script returning ${SECRET}`) },
      ],
    });
    expect((await driver.readCredentialValues()).ok).toBe(false);
    expect(JSON.stringify(getLogSink())).not.toContain(SECRET);
  });
});

describe("nothing it logs carries a value", () => {
  it("the success line is a COUNT", async () => {
    const { driver } = driverFor({
      answers: [
        { match: "editableTypes", value: ISSUED_CENSUS },
        { match: "wing-credential-cell-read", value: { ok: true, values: { vendor_id: VENDOR, access_key: ACCESS, secret_key: SECRET } } },
      ],
    });
    await driver.readCredentialValues();
    const spoken = JSON.stringify(getLogSink());
    for (const secret of [VENDOR, ACCESS, SECRET]) expect(spoken).not.toContain(secret);
    expect(spoken).toContain('"fields":3');
  });
});
