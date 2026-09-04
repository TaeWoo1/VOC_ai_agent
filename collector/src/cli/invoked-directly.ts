import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * "Was THIS module the one node was told to run?" — for the `if (invoked directly) main()` guard every CLI
 * in this package ends with, so importing one stays side-effect-free.
 *
 * <p>The old test, `import.meta.url === pathToFileURL(process.argv[1]).href`, is true for EVERY module
 * inside one bundle: they all share the bundle's URL, and the bundle is what argv[1] names. The first
 * packaged helper (Local Helper Pilot Packaging v1) therefore ran eleven CLIs' `main()` on boot and printed
 * a NAVER tutorial banner instead of starting. Each guard now also states the source file it lives in, and
 * a bundle named `helper.mjs` matches none of them — the bundle's own entry calls the function it wants.
 */
export function invokedDirectly(metaUrl: string, sourceFile: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    if (metaUrl !== pathToFileURL(argv1).href) return false;
    const own = basename(fileURLToPath(metaUrl));
    // `local-agent.ts` when run through tsx, `local-agent.js` if ever compiled — never `helper.mjs`.
    return own === sourceFile || own.replace(/\.[cm]?[jt]s$/, "") === sourceFile.replace(/\.[cm]?[jt]s$/, "");
  } catch {
    return false;
  }
}
