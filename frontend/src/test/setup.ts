// FE-6 test setup — runs before every test file (node-env and jsdom alike).
//
// `@testing-library/jest-dom/vitest` extends vitest's `expect` with DOM matchers
// (toBeInTheDocument, toHaveAttribute, …) and their TypeScript types. It is inert
// for the node-env `*.test.ts` files: the matchers only touch the DOM when called,
// and those files never call them.
//
// Because the harness keeps `globals: false`, React Testing Library's automatic
// afterEach cleanup is not auto-registered — we wire it explicitly so each jsdom
// test starts from an empty document.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
