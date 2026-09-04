// Uninstall companion (Helper Device Authentication v1): tell the reviewnary server this helper is gone, then
// forget the device token. Best effort — the seller can also revoke from 설정 › 연결된 기기. Prints nothing
// sensitive; the token is read from the 0600 file and sent once as a bearer, never echoed.
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const home = process.env.REVIEWNARY_HELPER_HOME;
if (!home) process.exit(0);
const path = resolve(home, ".auth", "device.json");
if (!existsSync(path)) process.exit(0);
let link = null;
try {
  link = JSON.parse(readFileSync(path, "utf8"));
} catch {
  link = null;
}
if (link && typeof link.token === "string" && typeof link.baseUrl === "string") {
  try {
    await fetch(`${link.baseUrl}/api/helper-devices/me`, { method: "DELETE", headers: { authorization: `Bearer ${link.token}` } });
  } catch {
    // unreachable: the seller's 설정 screen still shows the device and can revoke it
  }
}
try {
  unlinkSync(path);
} catch {
  // nothing to forget
}
