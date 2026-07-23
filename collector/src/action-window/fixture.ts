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
  | "download-none"
  | "naver-review-export-xlsx";

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
/**
 * A review-export-shaped download control: an Excel-download anchor whose accessible wording resembles a
 * seller-center review export button (the R4/NAVER pilot surface shape). Still fully synthetic — NO
 * marketplace trademark, HTML, or seller data; only its structure/wording models the review-export case.
 */
const REVIEW_EXPORT_ANCHOR = (filename: string): string =>
  `<a data-aw-target data-aw-role="primary-action" data-aw-label="review-excel-download" download="${filename}" href="#">엑셀 다운로드</a>`;
/**
 * A NAVER-*shaped* review-management surface: a synthetic review list plus the review-export control.
 * Models the pilot channel's export surface structurally (review table + Excel download) with zero
 * marketplace trademark/markup/seller data — every row is synthetic fixture text.
 */
const REVIEW_EXPORT_SURFACE = (anchor: string): string => `
    <section data-aw-scope="review-export">
      <h2>리뷰 관리</h2>
      <table>
        <thead><tr><th>상품</th><th>별점</th><th>내용</th></tr></thead>
        <tbody>
          <tr><td>합성 상품 A</td><td>★★★★★</td><td>합성 리뷰 본문 1</td></tr>
          <tr><td>합성 상품 B</td><td>★★★★☆</td><td>합성 리뷰 본문 2</td></tr>
        </tbody>
      </table>
      <div class="aw-toolbar">${anchor}</div>
    </section>`;
/** Plain synthetic text payload (as a JS string-literal expression for the fixture script). */
const TEXT_PAYLOAD = `'sellerops synthetic fixture artifact\\n'`;
/**
 * Structurally OOXML-shaped payload: the ZIP local-header magic (`PK…`, all
 * single-byte code points so the Blob's UTF-8 bytes keep the magic intact) followed by the
 * content-types entry name — enough for the quarantine sniff, not a real workbook.
 */
const XLSX_PAYLOAD = `'PK\\u0003\\u0004\\u0014\\u0000\\u0000\\u0000\\u0008\\u0000[Content_Types].xml (sellerops synthetic fixture)'`;
/**
 * The payload expression for a REAL committed workbook, supplied as base64 by the caller
 * (`FixtureHtmlOptions.reviewExportBase64` — the golden `contracts/review-export/naver/v1` artifact).
 *
 * Why this exists: {@link XLSX_PAYLOAD} carries the ZIP magic and the content-types entry NAME, so it
 * satisfies the quarantine sniff — but it is not a workbook and no parser can read it. A fixture run
 * on that payload can therefore never prove anything downstream of validation. Handing the page the
 * real committed bytes makes the synthetic path's artifact the SAME bytes the backend ingest test
 * consumes. Structural validity is not ingestibility; only real bytes close that gap.
 *
 * Still fully synthetic: the committed workbook contains only invented rows (see the contract SPEC).
 */
const BASE64_PAYLOAD = (base64: string): string =>
  `Uint8Array.from(atob('${base64}'), function(c){ return c.charCodeAt(0); })`;
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

/** Caller-supplied fixture inputs. Absent → the fixture behaves exactly as it always has. */
export interface FixtureHtmlOptions {
  /**
   * Base64 of the committed golden review-export workbook. Applies to `naver-review-export-xlsx`
   * only. When supplied, the user's click fires a download of the REAL committed bytes instead of
   * the structurally-shaped stand-in. The fixture module itself never reads the filesystem — the
   * caller loads the artifact and passes it in.
   */
  reviewExportBase64?: string;
}

export function fixtureHtml(mode: FixtureMode, opts: FixtureHtmlOptions = {}): string {
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
    case "naver-review-export-xlsx":
      // NAVER-*shaped* review-export surface: a synthetic review list + an Excel-download control whose
      // click natively fires the OOXML-shaped blob — the R4 headed operator proof surface. Same
      // quarantine happy path as download-xlsx, but structured like a review export (single target).
      return page(REVIEW_EXPORT_SURFACE(REVIEW_EXPORT_ANCHOR("synthetic-review-export.xlsx")), {
        surface: true,
        state: true,
        downloadPayload: opts.reviewExportBase64 ? BASE64_PAYLOAD(opts.reviewExportBase64) : XLSX_PAYLOAD,
      });
  }
}
