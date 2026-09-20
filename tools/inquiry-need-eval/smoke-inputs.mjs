#!/usr/bin/env node
// The planner smoke inputs, from the committed synthetic scenarios — no customer text ever leaves the fixture.
//   node tools/inquiry-need-eval/smoke-inputs.mjs > /path/outside/the/repo/smoke-inputs.jsonl
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '../../contracts/inquiry-planner/v3/synthetic/planner-scenarios.jsonl');
const rows = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  .filter((s) => s.smoke)
  .map((s) => ({ q: s.id, question: s.question, registry: s.registry }));
if (!rows.length) throw new Error('no scenario is marked smoke');
process.stdout.write(rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
