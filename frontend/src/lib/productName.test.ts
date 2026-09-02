/**
 * <b>The name on the screen</b> — Core Daily Loop UX Integration v1 §3 / §14-J.
 *
 * The product is called reviewnary. `SellerOps` remains the name of the repository, the Java
 * packages, the environment variables, the database and the connector identifiers, and none of those
 * are renamed here — an internal name is not a lie to anybody. What a seller reads is a different
 * thing, and two names for one product on one screen is how a person decides they are looking at
 * something unfinished.
 *
 * <b>The exceptions are declared, not discovered.</b> The connection / onboarding / Action Window
 * family still says SellerOps because the string there is not only a brand: 「reviewnary 도우미」 names
 * a program the seller installs and then has to FIND on their own computer, and this repository
 * cannot verify what that installed application is actually called. Renaming the instruction without
 * renaming the thing it points at would be a worse defect than an inconsistent name.
 *
 * <b>2026-09-02 — NAVER Guided Acquisition Live Findings Closure v1 moved the guided COPY.</b> The
 * deferral was doing two jobs and only one of them was justified: naming the installed helper, and
 * naming the PRODUCT in guidance prose the helper draws. The second had no reason to wait, and a
 * live sitting had a seller reading 「SellerOps 안내」 on the panel of a product called reviewnary. So
 * every guided string whose subject is the product moved (the in-page panel's own title, the
 * walkthrough prose, the Coupang mirror), and only 「reviewnary 도우미」 — the installed program, and
 * the confirmation page's pointer at the window that program titles — stayed. The deferral count
 * therefore fell 40 → 29; the files that left are the ones whose SellerOps strings were all
 * product-name prose.
 *
 * <b>2026-09-02 — the helper's own name is a product-owner decision, and it was made.</b> The deferral
 * above rested on one thing this repository could not verify: what the installed program is actually
 * called on the seller's computer. The product owner settled it — the seller reads 「reviewnary 도우미」
 * — and the internal names it is deferred against (the launchd label `ai.sellerops.local-agent`, the
 * package, the env vars, the connector ids) are untouched, because an internal name is not a lie to
 * anybody. The same pass moved the product prose those screens still carried — 「reviewnary가 대신
 * 클릭하지 않아요」, 「reviewnary에 넘겼어요」, 「reviewnary 고정 호출 IP」 — because the pointer at a window
 * this repository had just renamed could not keep calling it something else. The count fell 29 → 6.
 *
 * Comments are not user-facing and are not scanned.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Screens whose product-name strings are deferred, with the reason, in the doc above. */
const DECLARED_EXCEPTIONS = [
  "src/components/actionWindow",
  "src/components/bridge",
  "src/components/connect",
  "src/components/coupang",
  "src/components/guidedConnection",
  "src/components/reviewImport",
  "src/lib/actionWindow",
  "src/lib/bridge",
  "src/lib/guidedConnection",
  "src/lib/coupangRenewal.ts",
  "src/lib/reviewImport.ts",
  "src/lib/reviewImport.test.ts",
  "src/pages/ConnectNaver.tsx",
  "src/pages/Operations.tsx",
  "src/pages/Operations.test.tsx",
  "src/pages/OperationsHome.tsx",
  "src/pages/OperationsHome.test.tsx",
  // This file. It holds the literal in order to look for it.
  "src/lib/productName.test.ts",
];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Everything that is not a comment. Block comments are blanked; `//` lines are dropped. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

describe("the product name a seller reads", () => {
  it("J — says reviewnary everywhere outside the declared exceptions", () => {
    const offenders = sources("src")
      .filter((path) => !DECLARED_EXCEPTIONS.some((prefix) => path.startsWith(prefix)))
      .filter((path) => code(readFileSync(path, "utf-8")).includes("SellerOps"));

    expect(offenders).toEqual([]);
  });

  it("J — the exceptions are a list somebody wrote down, not a directory that grew", () => {
    // If this number moves, a screen either joined or left the deferral and the doc above has to say
    // which. A silently growing allow-list is the same as no rule.
    const deferred = sources("src").filter((path) =>
      DECLARED_EXCEPTIONS.some((prefix) => path.startsWith(prefix)),
    ).filter((path) => code(readFileSync(path, "utf-8")).includes("SellerOps"));

    expect(deferred).toHaveLength(6);
  });

  it("the browser tab carries the product name", () => {
    const html = readFileSync("index.html", "utf-8");
    expect(html).toContain("reviewnary");
    expect(html).not.toContain("SellerOps");
  });
});
