import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const uploadTest = readFileSync(resolve(here, "upload.test.ts"), "utf8");

/**
 * <b>A test may not upload manufactured rows into an organisation that holds a seller's data.</b>
 *
 * The gated integration tests POST review CSV to a real local backend through the PRODUCTION ingest
 * path — `FileParser` → `ReviewRowMapper` → `IngestionService`, the same path a seller's own export
 * takes. That path records what it is handed and is right to: nothing in an upload says "this came
 * from a test". So the rows land as `data_origin = REAL`, indistinguishable from an export row.
 *
 * Both tests used to default to `demo@sellerops.ai`. Across five recorded runs, 23 fixture reviews
 * accumulated in that organisation and were still there months later — counted in 미답변, ranked in
 * 반복되는 문제, holding six manufactured products up as real in the 상품 catalogue, and drawn into a
 * review-evaluation sample. `V93__ingest_fixture_data_origin.sql` classified those rows; this is what
 * stops the next one being written.
 *
 * The ingest path is NOT the defect and is not changed. Nothing here widens `DataOrigin`, and no
 * caller may declare its own provenance — a client-supplied origin is exactly the contract this
 * product does not have.
 */
describe("gated integration uploads may not target a seller organisation", () => {
  it("authenticates through a throwaway signup, never a login with a seller credential", () => {
    const body = uploadTest.slice(uploadTest.indexOf('describe("live-backend integration (gated)"'));
    expect(body).not.toContain("demo@sellerops.ai");
    expect(body).not.toContain("SELLEROPS_EMAIL");
    expect(body).not.toContain("SELLEROPS_PASSWORD");
    // Every integration test in that block gets its token from the same place.
    const tokens = body.match(/const token = await (\w+)\(/g) ?? [];
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens)).toEqual(new Set(["const token = await disposableOrg("]));
  });

  it("the throwaway organisation is created through the product's own signup, on an unroutable domain", () => {
    const helper = uploadTest.slice(
      uploadTest.indexOf("async function disposableOrg"),
      uploadTest.indexOf('describe("live-backend integration (gated)"'),
    );
    expect(helper).toContain("/api/auth/signup");
    // `.invalid` is reserved by RFC 2606 and can never be delivered to.
    expect(helper).toContain("@example.invalid");
    // A fresh nonce per run: the org is never reused, so nothing accumulates anywhere a seller reads.
    expect(helper).toContain("randomUUID()");
  });
});
