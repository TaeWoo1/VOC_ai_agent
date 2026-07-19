# `review-body-fingerprint/v1`

A deterministic, one-way fingerprint of a review body, computed **identically** in Java (backend) and
TypeScript (collector) so a backend-derived target hint and a collector row match can never disagree. It is
**not** the display redactor (`VocPreviewSanitizer`) and it is **not** the reply-draft fingerprint
(`ReviewReplyFingerprint` / `review-reply-v1`, which hashes the operator's reply). This contract **owns its
own regexes** — neither side imports `PiiMasker` — so the fingerprint can never drift when display redaction
changes.

`golden-vectors.json` is the shared authority: **synthetic** cases only (no captured production samples). Both
implementations MUST reproduce every case's `normalized` from `raw` **and** hash to its `fingerprint`.

## Pipeline (`text → hex`), applied in exact order

1. **NFC** — Unicode NFC normalize.
2. **Line endings** — `\r\n` and lone `\r` → `\n`.
3. **Whitespace collapse** — replace every run of the **explicit** whitespace class below with a **single ASCII
   space** (`U+0020`). The class is pinned literally rather than language-default `\s`, because Java `(?U)\s`
   and JS `\s` disagree on some code points (JS `\s` includes `U+FEFF`; Java `(?U)\s` includes `U+0085`) — a
   difference that would silently diverge the two implementations. `U+FEFF` and zero-width `U+200B` are
   deliberately **not** whitespace (they survive), matching Java `(?U)\s`.
   ```
   U+0009 U+000A U+000B U+000C U+000D U+0020 U+0085 U+00A0 U+1680 U+2000..U+200A U+2028 U+2029 U+202F U+205F U+3000
   ```
   After this step the only whitespace anywhere is a single `U+0020`, which makes every later pattern trivially
   identical across Java and JS.
4. **Trim** — remove a single leading and a single trailing `U+0020` (only single spaces remain post-collapse).
5. **Tokenize volatile spans**, in this exact order (each whole match → its fixed token). Separators are
   `[-. ]?` (not `[-.\s]?`) because step 3 already reduced any whitespace separator to one `U+0020`:
   | # | pattern | token |
   |---|---|---|
   | 1 | `(?i)(?:https?://\|www\.)[^ ]+` | `[링크]` |
   | 2 | `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` | `[이메일]` |
   | 3 | `01[016789][-. ]?\d{3,4}[-. ]?\d{4}` | `[전화번호]` |
   | 4 | `0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}` | `[전화번호]` |
   | 5 | `(?<!\d)\d{7,}(?!\d)` | `[번호]` |
   Order matters: URL runs first (its `[^ ]+` swallows any digits/`@` inside a link); mobile runs before the
   generic long-number rule so an `01x…` number becomes `[전화번호]`, not `[번호]`.
   `\d` is **ASCII `[0-9]` on both sides** — Java compiles these patterns **without**
   `UNICODE_CHARACTER_CLASS`, and JS `\d` is ASCII — so non-ASCII digits (fullwidth `０-９`, Arabic-Indic
   `٠-٩`) are never tokenized. Do not add `Pattern.UNICODE_CHARACTER_CLASS` / `(?U)` here: it would tokenize
   non-ASCII digits on the Java side only and silently diverge the two implementations.
6. **Hash** — `SHA-256` of the **UTF-8** bytes of the result → **lowercase** hex (64 chars).

## Privacy
Pure function; **never logs its input**. The output is one-way (a hash); the normalized preimage has its
volatile PII-shaped spans tokenized. The fingerprint is the only value that ever leaves the deriving side.

## Non-goals (still blocking live use)
Proving Java ≡ TS on the **same input text** does not prove a live NAVER DOM row's rendered text normalizes to
the backend's **stored** body (truncation, entity encoding, emoji, trailing UI). That cross-**source**
reconciliation, and live in-page extraction, remain out of scope.
