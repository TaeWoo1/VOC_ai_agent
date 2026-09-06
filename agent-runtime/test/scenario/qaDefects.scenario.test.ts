/**
 * <b>The manual-QA defects, as conversations.</b>
 *
 * Cases in {@link ./cases.ts} — stated once, run twice: here against recorded plans (CI calls no
 * vendor), and in `bench/` against whichever model an arm names.
 */
import { describe } from "vitest";
import { scenario } from "./scenario";
import { QA_DEFECT_CASES } from "./cases";

describe("manual QA defects, as conversations", () => {
  for (const c of QA_DEFECT_CASES) scenario(c.name, c);
});
