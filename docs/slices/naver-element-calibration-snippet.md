# NAVER Element-Anchor Calibration — value-scoped DevTools snippet

Companion to `collector/src/cli/calibrate-element-anchors.ts` (the READ-ONLY calibration runtime) and
slice §0.2.15. The runtime only opens the correct logged-in Chrome and holds it open — it reads nothing.
**All evidence is collected here, in the operator's own DevTools**, by this snippet.

## What it does / does not collect

The snippet inspects the DevTools-**selected** element (`$0`) and up to 2 ancestors and emits **sanitized
structure only**:

- ✅ `tag`, `role`, `class` list
- ✅ `data-*` / `aria-*` attribute **names** (the list of which hooks exist)
- ✅ For a small **allowlist of test-hook attributes only** (`data-testid`, `data-test`, `data-qa`,
  `data-cy`, `data-component`, `data-role`) — the value, **only if** it passes a *positive* structural
  shape (starts with a letter, word/`-`/`:` chars only, ≤ 32 chars, no whitespace). Anything else is
  reported as `<omitted>`.
- ✅ `id` attribute, **only if** it passes the same positive structural shape; otherwise a length bucket
  (`<opaque:lenN>`), never the value
- ✅ a `labelMatch` classification (`api_group` / `application_id` / `null`) derived by comparing the
  element's **own direct text** against the KNOWN fixed labels — the raw text is not emitted
- ✅ `frame`: `top` vs `iframe`

It **never** emits: the Client ID / Secret value, any input/value field content, full `outerHTML`,
`document.cookie`, `localStorage`/`sessionStorage`, tokens, or any free-form attribute value (`aria-label`
text, seller/store names, etc.). The design is **allowlist + positive shape**, not "drop things that look
like a secret" — a value is emitted only when it is a clean structural token on a named hook. Select the
**LABEL** element (not the value field); the allowlist is the backstop if you mis-select.

## How to use

1. In the calibration Chrome window, reach one existing app's **detail** page.
2. DevTools → **Elements**. Click the **API 그룹** heading element so it is selected (`$0`).
3. DevTools → **Console**. Paste the snippet below, press Enter, copy the printed JSON.
4. Select the **애플리케이션 ID** label element (`$0`), run the snippet again, copy that JSON.
5. Paste **both** JSON blobs back into your SellerOps session.

## Snippet

```js
(() => {
  const KNOWN = { "API 그룹": "api_group", "애플리케이션 ID": "application_id" };
  // POSITIVE structural shape: letter-led, word/-/: chars only, <=32, no whitespace. NOT a "looks like a
  // secret" negative filter — a value is emitted ONLY if it is a clean structural token.
  const STRUCTURAL = /^[A-Za-z][A-Za-z0-9_:-]{0,31}$/;
  const HOOK_ATTRS = new Set(["data-testid", "data-test", "data-qa", "data-cy", "data-component", "data-role"]);
  const structuralOrNull = (s) => (typeof s === "string" && STRUCTURAL.test(s) ? s : null);
  const directText = (el) => Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => (n.nodeValue || "").trim())
    .join(" ")
    .trim();
  const attrs = (el) => {
    const dataAttrNames = [], ariaAttrNames = [], hookValues = {};
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith("data-")) {
        dataAttrNames.push(a.name);
        if (HOOK_ATTRS.has(a.name)) hookValues[a.name] = structuralOrNull(a.value) || "<omitted>";
      } else if (a.name.startsWith("aria-")) {
        ariaAttrNames.push(a.name); // NAME only — aria-label text is never emitted
      }
    }
    const idAttr = el.getAttribute("id");
    const idStruct = idAttr == null ? null : structuralOrNull(idAttr);
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      classes: Array.from(el.classList),
      dataAttrNames,
      ariaAttrNames,
      hookValues,
      id: idAttr == null ? null : (idStruct || `<opaque:len${idAttr.length}>`),
    };
  };
  const el = window.$0;
  if (!el) return "Select the LABEL element in the Elements panel first (so $0 is set), then re-run.";
  const t = directText(el);
  const chain = [];
  let cur = el, hops = 0;
  while (cur && hops < 3) { chain.push(attrs(cur)); cur = cur.parentElement; hops++; }
  const out = {
    labelMatch: KNOWN[t] || null,
    frame: window.top === window.self ? "top" : "iframe",
    self: chain[0],
    ancestors: chain.slice(1),
  };
  return JSON.stringify(out, null, 2);
})();
```
