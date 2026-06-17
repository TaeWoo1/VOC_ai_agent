package com.sellerops.ingest.map;

import java.util.Map;

/** Picks a value from a (lowercased-header) row by trying known column aliases. */
public final class HeaderAliases {

    private HeaderAliases() {
    }

    /** First non-blank value among the alias keys, or null. Aliases must be lowercase. */
    public static String pick(Map<String, String> row, String... aliases) {
        for (String alias : aliases) {
            String value = row.get(alias);
            if (value != null && !value.isBlank()) {
                return value.strip();
            }
        }
        return null;
    }
}
