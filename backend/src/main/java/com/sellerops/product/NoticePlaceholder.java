package com.sellerops.product;

import java.util.regex.Pattern;

/**
 * A 상품정보제공고시 value that points at the detail page instead of stating anything — 「상품상세참조」, 「상품 상세
 * 참조」, 「상세페이지 참조」.
 *
 * <p>NAVER requires every 고시 field to be filled, and sellers fill most of them with a pointer. The first live read of
 * the Demo Org's catalogue (2026-09-19) found 286 of 332 고시 values were exactly that. A pointer is not a statement
 * about the product: stored as {@code spec:크기 = 상품상세참조} it reads as «크기 is known», and a catalogue search that
 * «checked 상품 정보» over it checked nothing. So it is never a {@code spec:} fact.
 *
 * <p>The grammar is closed and matched after removing spaces and punctuation: optional 상품, 상세, an optional
 * 페이지/설명/정보/이미지/내용, then 참조 or 참고 with an optional polite tail. Anything else — including a real value that
 * merely mentions the page («규격은 상세페이지 참조, 2m») — is kept; the failure direction is keeping a pointer, never
 * dropping a statement.
 */
public final class NoticePlaceholder {

    private static final Pattern POINTER = Pattern.compile(
            "^(상품)?상세(페이지|설명|정보|이미지|내용)?(참조|참고)(바랍니다|해주세요|해주십시오|요망)?$");

    private NoticePlaceholder() {
    }

    public static boolean isPlaceholder(String value) {
        if (value == null) {
            return false;
        }
        String squashed = value.replaceAll("[\\s\\p{Punct}·「」『』\\[\\]()]", "");
        return !squashed.isEmpty() && POINTER.matcher(squashed).matches();
    }

    /** A {@code spec:} fact whose value is only a pointer — the one kind of fact this rule refuses. */
    public static boolean isPlaceholderSpec(String factKey, String value) {
        return factKey != null && FactKeys.SPEC.equals(FactKeys.namespaceOf(factKey)) && isPlaceholder(value);
    }
}
