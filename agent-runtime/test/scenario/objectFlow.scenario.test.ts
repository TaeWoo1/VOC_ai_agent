/**
 * <b>The exact-object flows, as scenarios.</b>
 *
 * Cases in {@link ./cases.ts}; this file replays them from recordings. Nothing here is new behaviour —
 * it is the behaviour that must not have moved, said in the format a QA defect now arrives in.
 */
import { describe } from "vitest";
import { scenario } from "./scenario";
import { OBJECT_FLOW_CASES } from "./cases";

describe("exact-object flows survive the procedure layer", () => {
  for (const c of OBJECT_FLOW_CASES) scenario(c.name, c);
});
