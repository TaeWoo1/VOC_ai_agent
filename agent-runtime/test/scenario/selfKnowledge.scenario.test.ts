/**
 * <b>What reviewnary can say about itself, as conversations.</b>
 *
 * Cases in {@link ./cases.ts} — stated once, run twice: here against the plans recorded live from
 * `agent-plan-prompt/v17` (CI calls no vendor), and in `bench/` against whichever model an arm names.
 */
import { describe } from "vitest";
import { scenario } from "./scenario";
import { SELF_KNOWLEDGE_CASES } from "./cases";

describe("product self-knowledge, as conversations", () => {
  for (const c of SELF_KNOWLEDGE_CASES) scenario(c.name, c);
});
