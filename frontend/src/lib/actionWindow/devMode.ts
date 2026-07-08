// The FE-1 mock scenario selector is a fixture/demo preview tool. It is DEV-only
// and must never appear in the production UI: gated on Vite's build-time `DEV`
// flag, so the production build tree-shakes it out entirely.
export function isFixturePreviewEnabled(): boolean {
  return import.meta.env.DEV === true;
}
