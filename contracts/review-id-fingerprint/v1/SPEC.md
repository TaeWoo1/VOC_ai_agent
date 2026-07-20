# `review-id-fingerprint/v1`

A deterministic, one-way fingerprint of a **channel-side review identifier**, computed identically by three
ports so that two sources can be proven to hold the same review id **without the raw id ever crossing a log
line, a report, an API response, or a persisted artifact**.

| Port | File |
|---|---|
| Node (collector) | `collector/src/action-window/reply-submission/review-id-fingerprint.ts` |
| In-page (browser) | `collector/src/action-window/reply-submission/review-id-fingerprint-inpage.ts` |
| Java (backend) | `backend/src/main/java/com/sellerops/common/ReviewIdFingerprint.java` |

Parity is proven by `golden-vectors.json` in this directory.

## What the identifier is

For NAVER SmartStore it is the review export's **`리뷰글번호`** column: a 10-digit number, present and unique
for every row of the analysed export (`docs/review_acquisition.md` §S). It is carried **untransformed** into
`reviews.external_id` — see `docs/action-window-runtime/r4-review-id-trace.md`.

## Algorithm

1. **Canonicalize** (`canonicalize` / `__awCanonicalizeReviewId`):
   1. `null`/`undefined` → `""`.
   2. Unicode **NFC**.
   3. Delete zero-width marks `U+200B U+200C U+200D U+FEFF` (invisible in a DOM read, so they must not change
      identity).
   4. Trim **leading and trailing** characters of the explicit White_Space class below.

   Deliberately **not** done: case folding, internal-whitespace collapsing, numeric coercion, prefix stripping.
   An identifier is compared as written; a value needing more repair is *malformed*, not *fixed*.

2. **Well-formedness** (`isWellFormed` / `__awIsWellFormedReviewId`) — all must hold:
   - length ≥ 1
   - length ≤ **120** (`reviews.external_id` is `varchar(120)`)
   - contains no White_Space-class character
   - contains no C0/C1 control (`U+0000–U+001F`, `U+007F–U+009F`)

3. **Digest** — `SHA-256` over the UTF-8 bytes of:

   ```
   "review-id-fingerprint/v1" + LF + canonical
   ```

   rendered as **lowercase 64-hex**. A malformed id yields **`null`**, never a digest — a caller must not be
   able to fingerprint-and-match garbage.

### Explicit White_Space class (pinned, not `\s`)

```
\t \n \v \f \r U+0020 U+0085 U+00A0 U+1680 U+2000–U+200A U+2028 U+2029 U+202F U+205F U+3000
```

Pinned literally for the same reason as `review-body-fingerprint/v1`: Java `(?U)\s` and JS `\s` disagree
(U+0085 vs U+FEFF) and would silently diverge the ports. In every port the exotic code points are written as
`\u` escapes, never literal characters.

## Domain separation

The `"review-id-fingerprint/v1" + LF` prefix means the same input string can **never** produce the same digest
under `review-body-fingerprint/v1` or `review-reply-v1`. Fingerprints from different contracts are therefore
never confusable, even though all three are 64-hex SHA-256.

## Honest limitation — read before citing this as a privacy control

A NAVER `리뷰글번호` is a **10-digit number**: roughly 10¹⁰ candidates, trivially enumerable by anyone who
wants to reverse a digest. This contract is a **leak-hygiene** device — it makes it structurally impossible for
a raw id to escape by accident through a log, a report, or an artifact — and it is **not** a privacy guarantee
against someone who already holds the id space. Do not describe it as one.

## Golden vectors

`golden-vectors.json` is **ASCII-only** (exotic code points appear as `\u` escapes) so no port can be broken by
transport mangling. It contains synthetic ids only — never a real seller review id. Each case carries `raw`,
`canonical`, `wellFormed`, and `fingerprint` (`null` when malformed), covering: the 10-digit NAVER shape, every
padding variant collapsing to one digest, an embedded zero-width, a BOM prefix, an alphanumeric id, NFD ≡ NFC,
the 120-char boundary, and the five malformed shapes (empty, whitespace-only, internal space, control
character, 121 chars).

**Every one of the 25 pinned whitespace code points has its own padded vector** (`ws-uXXXX-padded`), each
asserted to collapse to the same digest as the unpadded id. The "byte-identical across three ports" claim is
only worth as much as its vectors: a port that quietly dropped one code point from its class would otherwise
pass every test while diverging in production.
