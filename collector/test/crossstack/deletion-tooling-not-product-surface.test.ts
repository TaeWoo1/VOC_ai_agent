/**
 * **Scope fence: the WING key-deletion tooling is internal diagnostics, never a product surface.**
 *
 * Product-owner decision, 2026-08-08 (`docs/product-scope-v1.md` §7.19): `COUPANG_WING_KEY_DELETION` exists
 * only to put an operator-owned test account into a real no-key state so the first-issuance form can be
 * calibrated live. It is **not** part of seller onboarding. The normal onboarding states are: no key ⇒ guided
 * issuance · key present ⇒ connect · expiry ⇒ guided renewal · invalid ⇒ re-auth/reissue recovery. SellerOps
 * never recommends deleting an existing key, and never renders a deletion walkthrough.
 *
 * The fence matters because the deletion driver already exists and is genuinely useful — the cheap next step
 * for someone wiring "let the seller start over" would be to import it into the guided-connection flow. That
 * import is what this test forbids: deletion identifiers must not appear in any seller-facing tree.
 *
 * The scanner is exercised against a PLANTED fixture below, so a version of it that silently finds nothing
 * (a bad glob, an unreadable root, a broken matcher) fails here instead of passing vacuously.
 *
 * **What it does not catch, stated rather than implied:** it is a textual scan of source files, so it cannot
 * see a reference laundered through a renamed local alias or a generated string. It matches both the module
 * PATHS and the exported SYMBOL names, which covers a direct import and a barrel re-export; it does not
 * attempt to be a taint analysis. It is a fence against the easy mistake, not a proof of absence.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");

/** The seller-facing trees. The collector CLI/driver and `tools/coupang-local` are the tooling itself. */
const PRODUCT_TREES = ["frontend/src", "backend/src", "contracts"] as const;

/**
 * Identifiers that only the deletion tooling has. Deliberately NOT the bare word "delete": product code
 * legitimately deletes drafts, uploads and connections. The fence is about the WING key-deletion feature.
 */
const DELETION_IDENTIFIERS = [
  // module paths — how an import would name it
  "run-coupang-wing-deletion-live",
  "coupang-wing-deletion-driver",
  "wing-deletion-bootstrap",
  "wing-deletion-preflight",
  // exported symbols — so a future barrel re-export cannot launder the path away
  "COUPANG_WING_KEY_DELETION",
  "CoupangWingDeletionDriver",
  "WingDeletionPhase",
  "WING_DELETION_LABELS",
  "WING_DELETION_SELECTORS_CALIBRATED",
  "WING_DELETION_WARNING_LABEL",
  "WING_DELETION_TOTAL_STEPS",
] as const;

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".java", ".kt", ".sql", ".json", ".html"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage", "__snapshots__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

/** Returns `"<relative path>: <identifier>"` for every hit — the message names the offending file directly. */
function findDeletionReferences(root: string, trees: readonly string[]): string[] {
  const hits: string[] = [];
  for (const tree of trees) {
    const dir = join(root, tree);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const text = readFileSync(file, "utf8");
      for (const id of DELETION_IDENTIFIERS) {
        if (text.includes(id)) hits.push(`${relative(root, file)}: ${id}`);
      }
    }
  }
  return hits;
}

describe("the WING key-deletion tooling stays out of every seller-facing tree", () => {
  it("no deletion identifier appears in frontend, backend or contracts", () => {
    expect(findDeletionReferences(REPO_ROOT, PRODUCT_TREES)).toEqual([]);
  });

  it("each product tree actually exists and was actually scanned", () => {
    // Without this, a renamed tree would make the fence above pass by scanning nothing at all.
    for (const tree of PRODUCT_TREES) {
      const dir = join(REPO_ROOT, tree);
      expect(existsSync(dir), `${tree} is missing — the fence above would scan nothing`).toBe(true);
      expect(walk(dir).length, `${tree} yielded no scannable files`).toBeGreaterThan(0);
    }
  });

  it("the scanner DOES find a planted reference — it is not a no-op", () => {
    // Proves the matcher, the walk and the extension filter all work, without dirtying the real trees.
    const root = mkdtempSync(join(tmpdir(), "deletion-fence-"));
    try {
      mkdirSync(join(root, "frontend/src/components"), { recursive: true });
      writeFileSync(
        join(root, "frontend/src/components/Offender.tsx"),
        `import { runDeletion } from "../../lib/run-coupang-wing-deletion-live";\n`,
      );
      writeFileSync(join(root, "frontend/src/components/Fine.tsx"), `export const x = "delete draft";\n`);
      const hits = findDeletionReferences(root, ["frontend/src"]);
      expect(hits).toEqual(["frontend/src/components/Offender.tsx: run-coupang-wing-deletion-live"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the fence does not fire on ordinary product uses of the word 'delete'", () => {
    // A fence that flagged `deleteDraft` would be turned off within a week.
    const root = mkdtempSync(join(tmpdir(), "deletion-fence-ok-"));
    try {
      mkdirSync(join(root, "frontend/src"), { recursive: true });
      writeFileSync(
        join(root, "frontend/src/a.ts"),
        `export function deleteDraft() {}\nexport const DELETE_UPLOAD = "delete";\n// remove the connection\n`,
      );
      expect(findDeletionReferences(root, ["frontend/src"])).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the deletion tooling still exists where it belongs — this fence relocates nothing", () => {
    // The decision is "internal only", not "delete the tooling". If these disappear, the fence is passing
    // for the wrong reason and the live-proof capability was lost silently.
    for (const f of [
      "collector/src/cli/run-coupang-wing-deletion-live.ts",
      "collector/src/action-window/coupang-wing-deletion-driver.ts",
      "tools/coupang-local/wing-deletion-preflight.sh",
    ]) {
      expect(existsSync(join(REPO_ROOT, f)), `${f} is missing`).toBe(true);
    }
  });
});
