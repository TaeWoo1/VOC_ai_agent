/**
 * Channel text, as a seller should read it.
 *
 * <b>Why this exists.</b> Cafe24's board carries the customer's message as HTML — the first inquiry
 * on this org's 문의 screen literally opens with {@code <meta charset="utf-8">}, and NAVER review
 * bodies arrive with {@code &ldquo;} where the customer typed a quotation mark. Both reached the
 * screen verbatim: the list preview, the detail body and the draft's own quoted question. A seller
 * reading their inbox should never have to read markup.
 *
 * <b>What it does NOT do.</b> It does not render HTML and it does not touch what is stored. The
 * source row keeps exactly what the channel sent — this is a presentation step, applied where text
 * is displayed, so nothing here can change what an approved draft was checked against. Tags are
 * removed rather than interpreted (no {@code innerHTML}, no parser), so no markup a channel sends
 * can become live markup here.
 */

/** The entities that actually appear in this org's channel text, plus the four structural ones. */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  hellip: "…",
  middot: "·",
  ndash: "–",
  mdash: "—",
};

/**
 * Strip channel markup and decode entities.
 *
 * A closing block tag and a `<br>` become a newline, so a body that used tags for its
 * paragraphs keeps them; every other tag simply disappears. Runs of blank lines collapse to one, because a body built from
 * `<div>`s otherwise arrives as a column of empty space.
 */
export function plainText(value: string | null | undefined): string {
  if (!value) return "";
  const withBreaks = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]*>/g, "");
  const decoded = withoutTags.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Control characters are what a mangled entity decodes to; leaving those out keeps a broken
      // source from putting an invisible character into a body a seller is about to quote.
      return Number.isFinite(code) && code >= 32 ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED[body.toLowerCase()];
    return named ?? whole;
  });
  return decoded
    .replace(/[ \t ]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The same text on one line — for a row preview, where a newline is just a wider gap. */
export function previewText(value: string | null | undefined): string {
  return plainText(value).replace(/\s*\n+\s*/g, " ").trim();
}
