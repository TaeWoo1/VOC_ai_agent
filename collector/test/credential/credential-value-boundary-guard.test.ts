/**
 * **Where a credential VALUE is allowed to exist, in the source.**
 *
 * The unit tests beside this one prove the flow behaves. They cannot see the shape that would break it next: a
 * second caller of the read, a helper that logs the values map, a convenience that writes the triple to a file
 * "just for debugging". Those are structural, and structure is what a sweep can hold.
 *
 * The rule this enforces, in one sentence: **exactly one module builds the read, exactly one module calls it,
 * exactly one module puts it on a wire, and nothing anywhere writes it down.**
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COUPANG_CREDENTIAL_FIELDS } from "../../src/action-window/coupang-wing-credential-cells";
import { WING_HIGHLIGHT_LABELS } from "../../src/action-window/coupang-wing-issuance-driver";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");

/** Every `.ts` under `src/`, repo-relative to `src`. */
function sourceFiles(dir = SRC, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full, `${prefix}${name}/`);
    return name.endsWith(".ts") ? [`${prefix}${name}`] : [];
  });
}

function read(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** Source with comment lines stripped — prose mentioning a forbidden token has produced false failures before. */
function code(rel: string): string {
  return read(rel)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

const ALL = sourceFiles();

/** Files that mention `token`, excluding the file that defines it. */
function filesContaining(token: string, except: readonly string[]): string[] {
  return ALL.filter((f) => !except.includes(f) && code(f).includes(token));
}

describe("the read exists in exactly one place, and is reached from exactly one place", () => {
  it("only the credential driver builds the value-reading script", () => {
    const users = filesContaining(
      "buildCredentialCellReadScript",
      ["action-window/api-issuance-calibration/credential-cell-inpage.ts"],
    );
    expect(users).toEqual(["action-window/coupang-wing-credential-driver.ts"]);
  });

  it("only the handoff CLI calls the driver's read", () => {
    const users = filesContaining("readCredentialValues(", ["action-window/coupang-wing-credential-driver.ts"]);
    expect(users).toEqual(["cli/run-coupang-credential-handoff-live.ts"]);
  });

  it("only the handoff CLI puts the values on a wire", () => {
    const users = filesContaining("postCoupangCredentialHandoff", ["credential/credential-handoff-client.ts"]);
    expect(users).toEqual(["cli/run-coupang-credential-handoff-live.ts"]);
  });

  it("only the handoff CLI runs the flow that holds them", () => {
    const users = filesContaining("handOffCoupangCredential", ["credential/coupang-credential-handoff.ts"]);
    expect(users).toEqual(["cli/run-coupang-credential-handoff-live.ts"]);
  });
});

describe("nothing writes a value down", () => {
  /** The modules that can hold plaintext at all. The sweep is tightest here and looser nowhere. */
  const HOLDERS = [
    "credential/coupang-credential-handoff.ts",
    "credential/credential-handoff-client.ts",
    "action-window/coupang-wing-credential-driver.ts",
    "cli/run-coupang-credential-handoff-live.ts",
  ];

  it("no filesystem, clipboard, or storage sink in any module that can hold one", () => {
    // API surfaces, not words: the operator-facing banner says the values never reach the clipboard, and a
    // sweep that cannot tell a promise from a call would forbid making the promise.
    const SINKS = [
      "writeFileSync",
      "writeFile(",
      "appendFile",
      "navigator.clipboard",
      "writeText(",
      // Bypasses `log()` and its denylist entirely — the sink a value would reach if someone wanted it "just
      // for debugging". Named because the list is a denylist and is only ever as good as its entries.
      "process.stdout.write",
      "process.stderr.write",
      "localStorage",
      "sessionStorage",
    ];
    for (const f of HOLDERS) {
      const src = code(f);
      for (const sink of SINKS) expect(src, `${f} reaches ${sink}`).not.toContain(sink);
    }
  });

  it("no `log(` call in those modules is handed the values map", () => {
    // The shape that would leak: `log("...", { values })`, `log("...", read.values)`, `log("...", secrets)`.
    for (const f of HOLDERS) {
      for (const m of code(f).matchAll(/\blog\(([\s\S]*?)\n?\s*\);/g)) {
        const args = m[1] ?? "";
        for (const forbidden of ["values", "secrets", "read.values"]) {
          expect(args, `${f}: log() is handed \`${forbidden}\``).not.toMatch(
            new RegExp(`\\b${forbidden.replace(".", "\\.")}\\b`),
          );
        }
      }
    }
  });

  it("no `console.log` in those modules is handed the record's values, only the value-free record", () => {
    for (const f of HOLDERS) {
      for (const m of code(f).matchAll(/console\.(log|error)\(([\s\S]*?)\n?\s*\);/g)) {
        const args = m[2] ?? "";
        for (const forbidden of ["values", "secrets"]) {
          expect(args, `${f}: console carries \`${forbidden}\``).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
        }
      }
    }
  });

  it("the per-run digest salt is never supplied by production code", () => {
    // A fixed salt makes the digest a cross-run identifier and, for the low-entropy 업체코드, invertible offline.
    // The seam exists for tests; the property is that nothing under `src/` uses it.
    expect(filesContaining("CredentialDigestSalt.forTest", ["credential/credential-evidence.ts"])).toEqual([]);
    // …and no module that can hold plaintext passes the seam at all, under any name.
    for (const f of HOLDERS) expect(code(f), `${f} supplies a digest salt`).not.toMatch(/\bsalt\s*:/);
  });

  it("the destination of the POST is screened before anything is read", () => {
    // The one place all three plaintext values leave the process. Every other boundary here is screened;
    // review found this one was not, and an unscreened `SELLEROPS_BASE_URL` sends a Secret Key to any host.
    const cli = code("cli/run-coupang-credential-handoff-live.ts");
    expect(cli).toContain("screenCredentialBackendOrigin(cfg.baseUrl)");
    // …and the raw configured value must not survive past the screen.
    const call = "screenCredentialBackendOrigin(cfg.baseUrl)";
    const afterScreen = cli.slice(cli.indexOf(call) + call.length);
    expect(afterScreen, "the unscreened configured value is used after the screen").not.toContain("cfg.baseUrl");
  });

  it("the value-carrying result type is never returned by the flow that consumes it", () => {
    // `handOffCoupangCredential` returns `CredentialHandoffRecord`. If it ever returned the read result, the
    // plaintext would leave the one scope the whole design rests on. The SEAM legitimately returns the read
    // result — that is how the values get in — so the assertion is about the exported function's own signature.
    const src = code("credential/coupang-credential-handoff.ts");
    const signature = /export async function handOffCoupangCredential\([\s\S]*?\):\s*(\S+)\s*\{/.exec(src);
    expect(signature, "the flow's signature could not be read").not.toBeNull();
    expect(signature![1]).toBe("Promise<CredentialHandoffRecord>");
  });
});

describe("the read is behind a barrier, and the barrier names the whole chain", () => {
  const cli = code("cli/run-coupang-credential-handoff-live.ts");

  it("the CLI's confirm seam is the action barrier, at the CREDENTIAL_REVEAL kind", () => {
    expect(cli).toContain("confirmActionBarrier(");
    expect(cli).toContain('kind: "CREDENTIAL_REVEAL"');
  });

  it("the barrier discloses the send and the verification, not only the read", () => {
    // A press that authorizes a chain and names its first link has told the operator less than they agreed to.
    const spec = read("cli/run-coupang-credential-handoff-live.ts");
    expect(spec).toContain("연결 정보 저장소로 바로 보내");
    expect(spec).toContain("읽기 전용");
  });

  it("the driver itself decides nothing — it holds no confirmation and no barrier", () => {
    const driver = code("action-window/coupang-wing-credential-driver.ts");
    expect(driver).not.toContain("confirmActionBarrier");
    expect(driver).not.toContain("OPERATOR_UI_CONFIRMED");
  });
});

describe("the field contract does not drift", () => {
  it("the three labels restate the driver's own credential spec verbatim", () => {
    for (const field of COUPANG_CREDENTIAL_FIELDS) {
      expect(field.candidateQuery).toBe(WING_HIGHLIGHT_LABELS.credentials.candidateQuery);
    }
    // `Access Key` is the one label already live-calibrated; the other two ride the same query.
    expect(COUPANG_CREDENTIAL_FIELDS.map((f) => f.exactText)).toContain(WING_HIGHLIGHT_LABELS.credentials.exactText);
  });

  it("the ids ARE the backend's credential keys, so nothing translates between read and store", () => {
    // Pinned against `CredentialTemplates.COUPANG` (backend): access_key, secret_key, vendor_id. A mapping layer
    // is somewhere `access_key` and `secret_key` can be swapped, and that swap stores a credential that fails
    // verification with no visible cause.
    expect([...COUPANG_CREDENTIAL_FIELDS.map((f) => f.id)].sort()).toEqual(["access_key", "secret_key", "vendor_id"]);
  });
});
