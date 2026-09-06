/**
 * Aggregates the arm files into the comparison table, and — the part that matters — separates the
 * turns EVERY arm fails from the turns arms disagree on. The first group is a fact about this
 * repository; leaving it in the totals hides the second group, which is the only thing a model
 * choice can move.
 */
import { readFileSync, readdirSync } from "node:fs";

interface Turn { scenario: string; say: string; index: number; pass: boolean; violations: string[]; status: string; llmCalls: number; toolCalls: number; turnMs: number; planMs: number }
interface Report { arm: string; set: string; turns: number; passed: number; planCalls: number; planFailed: number; planUnsupported: number; planRetries: number; planP50: number; planP90: number; planP95: number; planMax: number; planMean: number; toolCallsTotal: number; llmCallsTotal: number; allTurns: Turn[] }

const dir = "bench/.out";
const set = process.argv[2] ?? "selection";
const files = readdirSync(dir).filter((f) => f.endsWith(`-${set}.json`));
const arms = files.map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as Report)
  .sort((a, b) => a.arm.localeCompare(b.arm));

const key = (t: Turn) => `${t.scenario}#${t.index}`;
const allKeys = [...new Set(arms.flatMap((a) => a.allTurns.map(key)))];
const failedByAll = allKeys.filter((k) => arms.every((a) => a.allTurns.find((t) => key(t) === k)?.pass === false));
const contested = allKeys.filter((k) => !failedByAll.includes(k)
  && arms.some((a) => a.allTurns.find((t) => key(t) === k)?.pass === false));

const tokensFor = (arm: string): { inTok: number; outTok: number; reason: number; n: number } => {
  let inTok = 0, outTok = 0, reason = 0, n = 0;
  try {
    for (const line of readFileSync(`${dir}/${arm}-${set}.planlog`, "utf8").split("\n")) {
      const m = /inTok=(\d+) outTok=(\d+) reasoningTok=(\d+)/.exec(line);
      if (!m) continue;
      inTok += +m[1]!; outTok += +m[2]!; reason += +m[3]!; n += 1;
    }
  } catch { /* an arm run without a restart has no log slice of its own */ }
  return { inTok, outTok, reason, n };
};

const pad = (s: string, n: number) => s.padEnd(n);
const row: string[] = [];
row.push(`set=${set} · turns=${arms[0]?.turns ?? 0} · arms=${arms.length}`);
row.push("");
row.push(`${pad("arm", 14)}${pad("acc", 12)}${pad("contested", 11)}${pad("p50", 8)}${pad("p90", 8)}${pad("p95", 8)}${pad("max", 8)}${pad("calls", 7)}${pad("unsup", 7)}${pad("retry", 7)}${pad("inTok", 8)}${pad("outTok", 8)}reason`);
for (const a of arms) {
  const t = tokensFor(a.arm);
  const cWin = contested.filter((k) => a.allTurns.find((x) => key(x) === k)?.pass).length;
  row.push(
    `${pad(a.arm, 14)}${pad(`${a.passed}/${a.turns} ${(100 * a.passed / a.turns).toFixed(1)}%`, 12)}` +
    `${pad(`${cWin}/${contested.length}`, 11)}${pad(String(a.planP50), 8)}${pad(String(a.planP90), 8)}` +
    `${pad(String(a.planP95), 8)}${pad(String(a.planMax), 8)}${pad(String(a.planCalls), 7)}` +
    `${pad(String(a.planUnsupported), 7)}${pad(String(a.planRetries), 7)}` +
    `${pad(t.n ? String(Math.round(t.inTok / t.n)) : "-", 8)}${pad(t.n ? String(Math.round(t.outTok / t.n)) : "-", 8)}` +
    `${t.n ? Math.round(t.reason / t.n) : "-"}`);
}
row.push("");
row.push(`── failed by EVERY arm (${failedByAll.length}) — product properties, not model differences ──`);
for (const k of failedByAll) {
  const t = arms[0]!.allTurns.find((x) => key(x) === k)!;
  row.push(`  «${t.say}»  ${t.violations.join(" · ")}`);
}
row.push("");
row.push(`── contested (${contested.length}) — where a model choice actually moves the product ──`);
for (const k of contested) {
  const t0 = arms[0]!.allTurns.find((x) => key(x) === k)!;
  row.push(`  «${t0.say}»`);
  for (const a of arms) {
    const t = a.allTurns.find((x) => key(x) === k);
    row.push(`      ${pad(a.arm, 14)}${t ? (t.pass ? "PASS" : `FAIL  ${t.violations.join(" · ")}`) : "—"}`);
  }
}
process.stdout.write(row.join("\n") + "\n");
