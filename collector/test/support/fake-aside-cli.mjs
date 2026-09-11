// A stand-in for the `aside` CLI, so the executor path is testable with no Aside installed.
//
// Modes (env FAKE_ASIDE_MODE):
//   result    — print `ASIDE_RESULT <FAKE_ASIDE_RESULT>` and exit 0
//   malformed — print a result line that is not JSON
//   silent    — print nothing, exit 0 (the shape of a program that threw: Aside exits 0 either way)
//   down      — stderr "Aside isn't running", exit 0
//   account   — stderr "Account not found: u9", exit 1
//   hang      — never exit
//   program   — EVALUATE the received program against a fake page described by FAKE_ASIDE_PAGE (JSON):
//               { counts:{sel:n}, texts:{sel:str}, attrs:{sel:{name:str}}, values:{sel:str}, download:{path,name}|null }
//               A "download" writes FAKE_ASIDE_DOWNLOAD_BYTES_PATH's bytes to `download.path` when clicked.
//
// Records the argv it was invoked with to FAKE_ASIDE_ARGV_OUT (JSON) so a test can assert the invocation.
import { writeFileSync, copyFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_ASIDE_ARGV_OUT) writeFileSync(process.env.FAKE_ASIDE_ARGV_OUT, JSON.stringify(args));

if (args[0] === "--version") {
  process.stdout.write("9.9.9-fake\n");
  process.exit(0);
}

const mode = process.env.FAKE_ASIDE_MODE ?? "result";
switch (mode) {
  case "result":
    process.stdout.write(`✔ Opened a new tab and set it active: tabs[0], page → (http://fixture.invalid/never-logged)\n`);
    process.stdout.write(`ASIDE_RESULT ${process.env.FAKE_ASIDE_RESULT ?? "{}"}\n`);
    process.stdout.write(`[ok | 12ms]\n`);
    process.exit(0);
  case "malformed":
    process.stdout.write("ASIDE_RESULT {not json\n");
    process.exit(0);
  case "silent":
    process.stderr.write("Error: boom\n    at repl.js:1:7\n[error | 9ms]\n");
    process.exit(0);
  case "down":
    process.stderr.write("fetch failed: connect ECONNREFUSED 127.0.0.1:21420\nAside isn't running.\n");
    process.exit(0);
  case "account":
    process.stderr.write("Account not found: u9\nRun 'aside account list' to see available accounts.\n");
    process.exit(1);
  case "hang":
    setInterval(() => {}, 1000);
    break;
  case "program": {
    const program = args[args.length - 1];
    const page = JSON.parse(process.env.FAKE_ASIDE_PAGE ?? "{}");
    const counts = page.counts ?? {};
    const texts = page.texts ?? {};
    const attrs = page.attrs ?? {};
    const values = page.values ?? {};
    const calls = [];
    const locator = (sel) => ({
      count: async () => counts[sel] ?? 0,
      click: async () => {
        calls.push(`click:${sel}`);
      },
      fill: async (v) => {
        calls.push(`fill:${sel}`);
        values[sel] = v;
      },
      selectOption: async () => {
        calls.push(`select:${sel}`);
      },
      waitFor: async () => {
        if ((counts[sel] ?? 0) === 0) throw new Error("waitFor timeout");
      },
      textContent: async () => texts[sel] ?? null,
      getAttribute: async (name) => attrs[sel]?.[name] ?? null,
      inputValue: async () => values[sel] ?? "",
    });
    const fakePage = {
      locator,
      waitForEvent: async (_event, opts) => {
        if (!page.download) {
          await new Promise((r) => setTimeout(r, Math.min(opts?.timeout ?? 50, 50)));
          throw new Error("download timeout");
        }
        if (process.env.FAKE_ASIDE_DOWNLOAD_BYTES_PATH) copyFileSync(process.env.FAKE_ASIDE_DOWNLOAD_BYTES_PATH, page.download.path);
        return {
          path: async () => page.download.path,
          suggestedFilename: () => page.download.name,
          failure: async () => null,
        };
      },
    };
    let opened = 0;
    let closed = 0;
    const env = {
      openTab: async () => {
        opened += 1;
        return fakePage;
      },
      closeTab: async () => {
        closed += 1;
      },
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const run = new AsyncFunction("openTab", "closeTab", "console", program);
    const out = [];
    await run(env.openTab, env.closeTab, { log: (line) => out.push(String(line)) });
    if (process.env.FAKE_ASIDE_TRACE_OUT) writeFileSync(process.env.FAKE_ASIDE_TRACE_OUT, JSON.stringify({ calls, opened, closed }));
    process.stdout.write(out.join("\n") + "\n[ok | 1ms]\n");
    process.exit(0);
  }
  default:
    process.stderr.write(`unknown FAKE_ASIDE_MODE ${mode}\n`);
    process.exit(2);
}
