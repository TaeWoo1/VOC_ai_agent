package com.sellerops.product.detail.image;

import java.text.Normalizer;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Which stored 규격 an image's {@code specLabel} refers to — <b>by exact match or not at all</b>.
 *
 * <p><b>This is the class the whole lane exists to keep small.</b> The 2026-08-26 defect was a
 * confident answer built on an association nobody made: a FAQ written per product answered a
 * question whose answer varies per 규격. Letting a model — or a similarity score — decide that
 * "2" on a picture means the variant named "2호" would rebuild that defect with more machinery.
 *
 * <p>So the only permitted match is <b>exact, whole-token, after normalization</b>. Forbidden, and
 * absent by construction rather than by policy: substring containment, edit distance, embeddings,
 * numeric reasoning, and asking the model. There is no scoring function here to tune.
 *
 * <p><b>Normalization is narrow on purpose.</b> Unicode NFKC, case folding, and whitespace collapse
 * — transformations that change how the same characters are ENCODED, never which characters they
 * are. It does not strip 호/mm/개, because dropping a unit is precisely how "2" starts matching
 * "2호".
 */
public final class ImageFactAssociation {

    private ImageFactAssociation() {
    }

    /**
     * The stored variant whose option name this label names exactly, or empty.
     *
     * <p>An option name is split on the axis separator the catalogue uses, so a two-axis variant
     * ("16x10mm / 화이트") is matchable by either axis's token — that is still an exact whole-token
     * match, not a substring one: "16x10" would NOT match "16x10mm".
     *
     * <p>Ambiguity refuses. A label matching two different stored variants names neither of them.
     */
    public static Optional<String> match(String specLabel, List<String> optionNames) {
        String normalized = normalize(specLabel);
        if (normalized.isEmpty() || optionNames == null || optionNames.isEmpty()) {
            return Optional.empty();
        }
        Set<String> hits = new LinkedHashSet<>();
        for (String option : optionNames) {
            if (option == null || option.isBlank()) {
                continue;
            }
            if (tokens(option).contains(normalized)) {
                hits.add(option);
            }
        }
        return hits.size() == 1 ? Optional.of(hits.iterator().next()) : Optional.empty();
    }

    /** The whole tokens of one stored option name: the full name and each axis of it. */
    static Set<String> tokens(String optionName) {
        Set<String> out = new LinkedHashSet<>();
        String whole = normalize(optionName);
        if (!whole.isEmpty()) {
            out.add(whole);
        }
        for (String part : optionName.split("[/|]")) {
            String token = normalize(part);
            if (!token.isEmpty()) {
                out.add(token);
            }
        }
        return out;
    }

    /**
     * NFKC, lower case, collapsed whitespace. Nothing is removed.
     *
     * <p>NFKC exists here for one concrete reason: Korean shops write 규격 with full-width digits and
     * compatibility characters, and the same 규격 typed on two keyboards must be one 규격. That is an
     * encoding difference. A unit is not.
     */
    static String normalize(String value) {
        if (value == null) {
            return "";
        }
        return Normalizer.normalize(value, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", " ")
                .strip();
    }
}
