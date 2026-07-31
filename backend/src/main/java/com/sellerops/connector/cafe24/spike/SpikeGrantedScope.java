package com.sellerops.connector.cafe24.spike;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Turns the raw {@code scope}/{@code scopes} string that Cafe24 returns on a token
 * response into <b>booleans over a closed vocabulary</b> — never exposing the raw
 * scope text. The production token DTOs deliberately drop the scope field
 * ({@code @JsonIgnoreProperties}); this spike parses it only to <i>verify</i> that
 * {@code mall.write_community} was actually granted, and fails closed if it was not.
 *
 * <p>Nothing here logs, returns, or stores the raw scope string — only the
 * {@code true}/{@code false} membership answers. This is the whole "granted-scope
 * verification method" for the reply spike: request read + write at consent, then
 * confirm the write grant here before any comment POST is attempted.
 */
public final class SpikeGrantedScope {

    /** The write scope a comment POST requires (developers.cafe24.com). */
    static final String WRITE_COMMUNITY = "mall.write_community";
    /** The read scope the spike also needs to observe the article/comment state. */
    static final String READ_COMMUNITY = "mall.read_community";

    private SpikeGrantedScope() {
    }

    /**
     * True only when {@code mall.write_community} is present in the granted scope
     * string. Blank/null → false (fail closed). Case-insensitive; accepts space-
     * and/or comma-separated forms (Cafe24 returns space-separated).
     */
    public static boolean writeCommunityGranted(String rawScopes) {
        return tokens(rawScopes).contains(WRITE_COMMUNITY);
    }

    /** True only when {@code mall.read_community} is present. Blank/null → false. */
    public static boolean readCommunityGranted(String rawScopes) {
        return tokens(rawScopes).contains(READ_COMMUNITY);
    }

    /**
     * The spike is only safe to attempt when BOTH read (to observe state) and write
     * (to post the comment) were granted. Either missing → fail closed.
     */
    public static boolean spikeScopesGranted(String rawScopes) {
        Set<String> tokens = tokens(rawScopes);
        return tokens.contains(READ_COMMUNITY) && tokens.contains(WRITE_COMMUNITY);
    }

    /** Lower-cased token set; the raw string never escapes this method. */
    private static Set<String> tokens(String rawScopes) {
        if (rawScopes == null || rawScopes.isBlank()) {
            return Set.of();
        }
        return new LinkedHashSet<>(Arrays.asList(
                rawScopes.strip().toLowerCase(Locale.ROOT).split("[\\s,]+")));
    }
}
