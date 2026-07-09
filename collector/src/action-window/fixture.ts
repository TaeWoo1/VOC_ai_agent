/**
 * **Local synthetic Action Window fixture (R1).** A deterministic, generic "seller-center" page.
 * NO real marketplace HTML, trademarks, seller data, credentials, or copied platform content.
 *
 * The fixture models: one expected target, a visible pre-action state, a changed post-action state
 * (a semantic `data-aw-state="done"` marker), a stable observation signal, and layout movement to
 * exercise overlay repositioning. Negative modes model the fail-closed cases. The page exposes two
 * deterministic hooks for tests/QA — `window.__awShiftLayout()` and `window.__awReplaceTarget()` —
 * so no timers are needed.
 */
export type FixtureMode =
  | "normal"
  | "no-candidate"
  | "multi-candidate"
  | "replaced"
  | "unchanged"
  | "session-required"
  | "download"
  | "download-xlsx"
  | "download-badmagic"
  | "download-none";

const TARGET_BUTTON = (label: string, extra = ""): string =>
  `<button data-aw-target data-aw-role="primary-action" data-aw-label="${label}" ${extra}>내보내기</button>`;

/**
 * The download-mode target: an anchor with the `download` attribute, so the USER's real click
 * natively fires a browser download of the synthetic blob — no programmatic click exists anywhere
 * (the page merely prepares the href on load). Models a platform export control that downloads
 * directly. Payloads are generic synthetic bytes: no marketplace content, no seller data.
 */
const TARGET_DOWNLOAD_ANCHOR = (filename: string): string =>
  `<a data-aw-target data-aw-role="primary-action" data-aw-label="export-download" download="${filename}" href="#">내보내기</a>`;
/** Plain synthetic text payload (as a JS string-literal expression for the fixture script). */
const TEXT_PAYLOAD = `'sellerops synthetic fixture artifact\\n'`;
/**
 * Structurally OOXML-shaped payload: the ZIP local-header magic (`PK…`, all
 * single-byte code points so the Blob's UTF-8 bytes keep the magic intact) followed by the
 * content-types entry name — enough for the quarantine sniff, not a real workbook.
 */
const XLSX_PAYLOAD = `'PK\\u0003\\u0004\\u0014\\u0000\\u0000\\u0000\\u0008\\u0000[Content_Types].xml (sellerops synthetic fixture)'`;
const DOWNLOAD_HREF_SCRIPT = (payloadLiteral: string): string => `
  (function(){
    var t = document.querySelector('a[data-aw-target][download]');
    if (t) t.setAttribute('href', URL.createObjectURL(new Blob([${payloadLiteral}], { type: 'application/octet-stream' })));
  })();`;

/** A click handler that flips the page into the verified post-state. Omitted in "unchanged" mode. */
const STATE_SCRIPT = `
  document.querySelectorAll('[data-aw-target]').forEach(function(b){
    b.addEventListener('click', function(){
      document.body.setAttribute('data-aw-state', 'done');
      var r = document.getElementById('aw-result'); if (r) r.textContent = '완료';
    });
  });`;

const HOOKS_SCRIPT = `
  window.__awShiftLayout = function(){
    var s = document.getElementById('aw-spacer'); if (s) s.style.height = '480px';
  };
  window.__awReplaceTarget = function(){
    var t = document.querySelector('[data-aw-target]');
    if (t) t.setAttribute('data-aw-label', 'changed-after-highlight');
  };`;

function page(body: string, opts: { surface: boolean; state: boolean; downloadPayload?: string }): string {
  const surfaceAttr = opts.surface ? ' data-aw-surface="seller-center"' : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;margin:0;padding:24px}
    #aw-spacer{height:40px;transition:none}
    button,a[data-aw-target]{font-size:16px;padding:10px 18px;display:inline-block}
  </style></head><body${surfaceAttr}>
    <h1>운영 작업</h1>
    <div id="aw-spacer"></div>
    <main>${body}</main>
    <p id="aw-result"></p>
    <script>${opts.state ? STATE_SCRIPT : ""}${opts.downloadPayload ? DOWNLOAD_HREF_SCRIPT(opts.downloadPayload) : ""}${HOOKS_SCRIPT}</script>
  </body></html>`;
}

export function fixtureHtml(mode: FixtureMode): string {
  switch (mode) {
    case "normal":
      return page(TARGET_BUTTON("export-reviews"), { surface: true, state: true });
    case "unchanged":
      return page(TARGET_BUTTON("export-reviews"), { surface: true, state: false });
    case "replaced":
      return page(TARGET_BUTTON("export-reviews"), { surface: true, state: true });
    case "no-candidate":
      return page(`<p>대상이 없습니다.</p>`, { surface: true, state: false });
    case "multi-candidate":
      return page(TARGET_BUTTON("export-reviews") + TARGET_BUTTON("export-reviews"), { surface: true, state: true });
    case "session-required":
      // No surface marker → the Runtime treats this as an invalid/unsupported surface.
      return page(`<section id="login-gate"><p>로그인이 필요합니다.</p></section>`, { surface: false, state: false });
    case "download":
      // The user's click on the anchor natively fires a REAL synthetic-blob download (and flips the
      // post-state). Pairs with the browser driver's read-only real download detection.
      return page(TARGET_DOWNLOAD_ANCHOR("synthetic-export.txt"), { surface: true, state: true, downloadPayload: TEXT_PAYLOAD });
    case "download-xlsx":
      // Same native user-click download, but the payload is structurally OOXML-shaped and the name
      // is xlsx — the quarantine validation happy path.
      return page(TARGET_DOWNLOAD_ANCHOR("synthetic-export.xlsx"), { surface: true, state: true, downloadPayload: XLSX_PAYLOAD });
    case "download-badmagic":
      // xlsx-NAMED but structurally NOT OOXML — the quarantine validation fail-closed path.
      return page(TARGET_DOWNLOAD_ANCHOR("synthetic-export.xlsx"), { surface: true, state: true, downloadPayload: TEXT_PAYLOAD });
    case "download-none":
      // The verified action fires NO download → exercises the DOWNLOAD_TIMEOUT fail-closed path.
      return page(TARGET_BUTTON("export-download"), { surface: true, state: true });
  }
}
