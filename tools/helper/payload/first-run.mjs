// First run of the packaged reviewnary 도우미: ask for the seller's reviewnary login in a native macOS dialog,
// verify it against the server (POST /api/auth/login, the same call the app makes), and write helper.env (0600).
// The password is typed into the OS dialog with a hidden answer, never into a terminal, and never printed.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const home = process.env.REVIEWNARY_HELPER_HOME;
const baseUrl = process.env.REVIEWNARY_BASE_URL ?? "http://127.0.0.1:8080";
const appUrl = process.env.REVIEWNARY_APP_URL ?? "http://localhost:5173";
if (!home) { console.error("REVIEWNARY_HELPER_HOME is required"); process.exit(2); }

function ask(prompt, hidden) {
  const script = `display dialog ${JSON.stringify(prompt)} default answer "" with title "reviewnary 도우미" ${hidden ? "with hidden answer" : ""} buttons {"취소", "확인"} default button "확인"
return text returned of result`;
  try {
    return execFileSync("/usr/bin/osascript", ["-e", script], { encoding: "utf8" }).trim();
  } catch {
    return null; // 취소
  }
}

for (let attempt = 0; attempt < 3; attempt++) {
  const email = ask("reviewnary 로그인 이메일을 입력해 주세요.", false);
  if (email === null) process.exit(3);
  const password = ask("reviewnary 비밀번호를 입력해 주세요. (입력한 글자는 보이지 않습니다)", true);
  if (password === null) process.exit(3);
  let ok = false;
  try {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (ok) {
    const path = resolve(home, "helper.env");
    writeFileSync(path, [
      "# reviewnary 도우미 — 이 Mac에서만 쓰는 로그인. 0600, 절대 공유하지 마세요.",
      `SELLEROPS_BASE_URL=${baseUrl}`, `SELLEROPS_APP_URL=${appUrl}`,
      `SELLEROPS_EMAIL=${email}`, `SELLEROPS_PASSWORD=${password}`, "",
    ].join("\n"), { mode: 0o600 });
    chmodSync(path, 0o600);
    process.exit(0);
  }
  execFileSync("/usr/bin/osascript", ["-e", 'display dialog "로그인에 실패했습니다. 이메일과 비밀번호를 다시 확인해 주세요." with title "reviewnary 도우미" buttons {"확인"} default button "확인"']);
}
process.exit(3);
