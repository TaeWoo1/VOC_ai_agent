package com.sellerops.collect.runtime;

/**
 * Coarse count bucket for sanitized output. Exact row counts are an internal/DB concern;
 * anything logged or exposed uses a bucket so a precise volume never leaks.
 */
public enum RowCountBucket {
    ZERO,
    ONE,
    FEW,            // 2-9
    TENS,           // 10-99
    HUNDREDS,       // 100-999
    THOUSANDS_PLUS; // 1000+

    public static RowCountBucket of(int n) {
        if (n <= 0) {
            return ZERO;
        }
        if (n == 1) {
            return ONE;
        }
        if (n < 10) {
            return FEW;
        }
        if (n < 100) {
            return TENS;
        }
        if (n < 1000) {
            return HUNDREDS;
        }
        return THOUSANDS_PLUS;
    }
}
