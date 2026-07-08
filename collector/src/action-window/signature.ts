/**
 * Shared in-page target-signature factory. Computing the signature INSIDE the page means only an
 * opaque 16-hex hash ever leaves the browser — raw labels/selectors/text never reach the Runtime or
 * the contract. Both the locator and the verifier use this one source so their signatures agree.
 */

/** A JS expression string that evaluates to `(role, label) => string16hex`. Injected via evaluate. */
export const IN_PAGE_SIG_FACTORY = `(function(role, label){
  var s = String(role) + '|' + String(label);
  var h1 = 0x811c9dc5 >>> 0;
  var h2 = 0x1000193 >>> 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    h1 = ((h1 ^ c) >>> 0); h1 = ((h1 * 0x01000193) >>> 0);
    h2 = ((h2 ^ (c + i)) >>> 0); h2 = ((h2 * 0x01000193) >>> 0);
  }
  function hex(n){ return (n >>> 0).toString(16).padStart(8, '0'); }
  return hex(h1) + hex(h2);
})`;

/** Attribute names the fixture uses. The locator/verifier read these; none of them leave the page. */
export const TARGET_ATTR = "data-aw-target";
export const ROLE_ATTR = "data-aw-role";
export const LABEL_ATTR = "data-aw-label";
export const SURFACE_SELECTOR = '[data-aw-surface="seller-center"]';
export const STATE_DONE = "done";
