// Ambient shim: model Vite's build-time `import.meta.env` so `tsc` can TYPE-CHECK the
// frontend modules this cross-stack test imports (they read `import.meta.env` inside
// function bodies — `devMode.ts`, `bridgeClient.ts`). At RUNTIME the values come from
// Vitest's Vite pipeline; the env-reading functions are never invoked by this test,
// which composes the transport directly (see the test header). Type-only, test-scoped.
interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly PROD?: boolean;
  readonly MODE?: string;
  readonly VITE_AW_BRIDGE?: string;
  readonly VITE_BRIDGE_URL?: string;
  readonly [key: string]: unknown;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
