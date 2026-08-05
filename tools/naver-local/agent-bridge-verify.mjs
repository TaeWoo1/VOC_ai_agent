// NAVER walkthrough — Local Agent bridge REACHABILITY verify (sanitized, no NAVER call).
//
// Proves the Local Agent launched by run-agent-local.sh is up on the SAME loopback endpoint the frontend's
// bridge client uses — `GET http://127.0.0.1:47615/bridge/health`, presence = `res.ok`, exactly the check
// `BridgeClient.refresh()` performs (frontend/src/lib/bridge/bridgeClient.ts). It makes NO pairing request,
// mints NO ticket, opens NO socket, and reaches NO NAVER/marketplace host — it only answers "is the agent
// reachable where the frontend will look for it?". It cannot and does not assert a shared run id: the agent
// announces its own opaque run id per connection (there is no walkthrough↔agent run binding).
//
// Env: BRIDGE_PORT (default 47615). Exit 0 = reachable (PASS), 1 = not reachable / wrong response (FAIL).
const PORT = Number(process.env.BRIDGE_PORT || 47615);
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS || 4000);

function log(ok, name, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  // Guard: only ever the loopback bridge host — never a marketplace host, even if the port were mis-set.
  const url = new URL(`${BASE}/bridge/health`);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    log(false, "endpoint is loopback", url.hostname);
    console.log("AGENT-BRIDGE-VERIFY FAIL");
    process.exit(1);
  }

  let reachable = false;
  let status = "no-response";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    reachable = res.ok; // mirror BridgeClient.refresh(): presence == res.ok
    status = `http ${res.status}`;
  } catch (e) {
    status = e && e.name === "AbortError" ? "timeout" : "connection-refused";
  } finally {
    clearTimeout(timer);
  }

  log(reachable, `Local Agent bridge reachable at 127.0.0.1:${PORT}/bridge/health`, status);
  if (!reachable) {
    console.log("  hint: start it with tools/naver-local/run-agent-local.sh (issuance guidance carrier)");
  }
  console.log(reachable ? "AGENT-BRIDGE-VERIFY PASS" : "AGENT-BRIDGE-VERIFY FAIL");
  process.exit(reachable ? 0 : 1);
}

main().catch(() => {
  console.log("  FAIL  verify crashed");
  console.log("AGENT-BRIDGE-VERIFY FAIL");
  process.exit(1);
});
