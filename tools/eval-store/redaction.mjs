// Redaction gate for the private eval store (Inquiry v3 WP-1 Stage 0).
//
// A file enters the canonical store only when this gate finds nothing. It REFUSES — it never edits a frozen file,
// because an edited file is a different dataset and must get a new version and a new hash. `redact()` exists for the
// step BEFORE a new version is frozen: it masks what the rules find, and the masked bytes are what get hashed.
//
// The findings name a rule, a line and a JSON path. They never carry the matched value: a gate that prints the phone
// number it caught has just copied it into a terminal and a log.

/**
 * Deterministic rules. Deliberately over-inclusive where a miss would leak identity (long digit runs catch order and
 * product-order numbers), deliberately silent on what this dataset legitimately holds: 8-hex id prefixes, sizes such
 * as "1.5sq" or "10mm", counts such as "4000매".
 */
export const RULES = [
  { id: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: 'KR_RRN', re: /\b\d{6}-?[1-4]\d{6}\b/g },
  { id: 'CARD_NUMBER', re: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g },
  { id: 'KR_PHONE', re: /(?<!\d)0(?:1[016789]|2|[3-6][1-5]|70)[- .]?\d{3,4}[- .]?\d{4}(?!\d)/g },
  // Order numbers, product-order ids, invoice numbers: eleven or more digits in a row.
  { id: 'LONG_NUMBER', re: /(?<!\d)\d{11,}(?!\d)/g },
  // A Korean road address: <시/도> <구/군/시> <…로/길> <number>.
  { id: 'KR_ADDRESS', re: /[가-힣]+(?:시|도)\s+[가-힣]+(?:구|군|시)\s+[가-힣0-9]+(?:로|길)\s*\d+/g },
  // A person's name addressed by a seller: 「홍길동 고객님」. The name must be a whole word — 「안녕하세요 고객님」 is a
  // greeting, and without the boundary 「하세요」 reads as a name (measured: all 22 hits in the calibration captures).
  // Names written without an honorific are NOT detectable by a rule; a new text dataset needs a human read as well.
  { id: 'NAME_HONORIFIC', re: /(?<![가-힣])[가-힣]{2,4}\s?고객님/g },
];

/** Every string leaf of a JSON value, with its path. */
function* leaves(value, path = '$') {
  if (typeof value === 'string') {
    yield [path, value];
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* leaves(value[i], `${path}[${i}]`);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* leaves(v, `${path}.${k}`);
  }
}

/** Rules that fire on one string. */
export function matchRules(text) {
  const hits = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    if (r.re.test(text)) hits.push(r.id);
  }
  return hits;
}

/**
 * Scan a file's bytes. JSON lines are scanned leaf by leaf (so a hit names the field); anything else line by line.
 * @returns {{rule: string, line: number, path: string|null}[]} — never the matched text
 */
export function scan(content) {
  const findings = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined && typeof parsed === 'object') {
      for (const [path, s] of leaves(parsed)) {
        for (const rule of matchRules(s)) findings.push({ rule, line: i + 1, path });
      }
    } else {
      for (const rule of matchRules(line)) findings.push({ rule, line: i + 1, path: null });
    }
  });
  return findings;
}

/** Mask every match with its rule id — for preparing a NEW version, never for editing a frozen one. */
export function redact(text) {
  let out = text;
  for (const r of RULES) {
    r.re.lastIndex = 0;
    out = out.replace(r.re, `[${r.id}]`);
  }
  return out;
}
