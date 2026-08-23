package com.sellerops.product;

import java.text.Normalizer;
import java.util.Locale;

/**
 * What counts as the same product name when a seller types one.
 *
 * <p>Four steps and no fifth: NFC, trim, lowercase, collapse runs of whitespace. They are exactly the
 * steps {@code ContentHash.normalize} already applies for dedup, and they are the only ones that are
 * safe here — each one erases a difference that is invisible on screen ("판도리  일체형" and
 * "판도리 일체형" are the same title typed twice), and nothing else does.
 *
 * <p><b>Anything beyond that would be a guess wearing a normalizer's clothes.</b> Stripping brackets,
 * dropping "정품", ignoring digits or comparing edit distance would let "선바로 2p" answer for
 * "선바로 4p"; the demo org carries pairs exactly that close. A resolver that cannot tell them apart
 * must return both and say so, not pick one — see {@link ProductQueryService}.
 */
public final class ProductNameKey {

    private ProductNameKey() {
    }

    /** The comparison key for a name, SKU or listing title. Null and blank both key to "". */
    public static String of(String raw) {
        if (raw == null) {
            return "";
        }
        return Normalizer.normalize(raw, Normalizer.Form.NFC)
                .strip()
                .toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", " ");
    }
}
