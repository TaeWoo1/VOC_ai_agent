package com.sellerops.product.detail;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The pictures the seller put ON their 상세페이지 — and <b>only</b> those.
 *
 * <p><b>This class exists because of a near-miss.</b> {@code NaverProductDetail} already carries a
 * field called {@code imageUrls}, and reaching for it would have been the obvious move. It is the
 * wrong set: it is {@code representativeImage} + {@code optionalImages}, the listing GALLERY — product
 * photographs shown beside the price, 10 of them on the measured listing. The 상세페이지 images are
 * the 26 {@code <img>} tags inside {@code detailContent}, and they are where a spec table lives. A
 * grounding lane fed the gallery would be reading photographs of the product and reporting that the
 * page said nothing.
 *
 * <p><b>So the separation is structural, not a convention.</b> This class takes ONE argument — the
 * {@code detailContent} markup — and there is no overload, no builder and no setter through which a
 * gallery URL could arrive. {@code DetailImageReferencesTest} asserts by source scan that nothing in
 * {@code main} passes {@code imageUrls()} into this lane.
 *
 * <p><b>It parses and it filters; it never fetches.</b> {@code data:} URIs, non-HTTP schemes and
 * plain {@code http://} are dropped here rather than at the fetcher, because a URL that will be
 * refused is not a candidate and counting it as one would overstate the work. Everything dropped is
 * COUNTED and reported — a silent filter reads as "the page had fewer pictures than it has".
 */
public final class DetailImageReferences {

    /**
     * A sanity ceiling on how many references are returned at all, before any per-product budget.
     *
     * <p>Not the model budget and not the fetch budget — those belong to their callers. This exists
     * so that a pathological page (a generated catalogue with thousands of tiles) cannot turn one
     * parse into an unbounded list held in memory.
     */
    public static final int MAX_REFERENCES = 200;

    private static final Pattern IMG_TAG = Pattern.compile("(?is)<\\s*img\\b[^>]*>");
    private static final Pattern SRC_ATTR =
            Pattern.compile("(?is)\\bsrc\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))");

    private DetailImageReferences() {
    }

    /**
     * What one 상세페이지 pointed at.
     *
     * @param urls            the fetchable references, https only, de-duplicated, in document order
     * @param imgTags         how many {@code <img>} tags the page carried at all
     * @param withoutSrc      tags with no usable {@code src}
     * @param inlineData      {@code data:} URIs — the picture is already in the markup, not on a CDN
     * @param insecureOrOther {@code http://} and every other scheme, refused before the fetcher
     * @param duplicateUrls   references that repeated a URL already seen on this page
     * @param overCeiling     references dropped by {@link #MAX_REFERENCES}
     */
    public record References(List<String> urls, int imgTags, int withoutSrc, int inlineData,
                             int insecureOrOther, int duplicateUrls, int overCeiling) {

        public int fetchable() {
            return urls.size();
        }

        /** Counts only. No URL, no markup, no seller text — safe for a log or an evidence row. */
        public String describe() {
            return "img_tags=" + imgTags + " fetchable=" + urls.size() + " without_src=" + withoutSrc
                    + " inline_data=" + inlineData + " insecure_or_other=" + insecureOrOther
                    + " duplicate_urls=" + duplicateUrls + " over_ceiling=" + overCeiling;
        }
    }

    /** Read the {@code <img src>} references out of one listing's {@code detailContent}. */
    public static References extract(String detailContent) {
        if (detailContent == null || detailContent.isBlank()) {
            return new References(List.of(), 0, 0, 0, 0, 0, 0);
        }
        Set<String> seen = new LinkedHashSet<>();
        List<String> urls = new ArrayList<>();
        int tags = 0;
        int withoutSrc = 0;
        int inlineData = 0;
        int insecure = 0;
        int duplicates = 0;
        int overCeiling = 0;

        Matcher tag = IMG_TAG.matcher(detailContent);
        while (tag.find()) {
            tags++;
            String src = srcOf(tag.group());
            if (src == null || src.isBlank()) {
                withoutSrc++;
                continue;
            }
            String normalized = normalize(src);
            if (normalized == null) {
                if (src.regionMatches(true, 0, "data:", 0, 5)) {
                    inlineData++;
                } else {
                    insecure++;
                }
                continue;
            }
            if (!seen.add(normalized)) {
                duplicates++;
                continue;
            }
            if (urls.size() >= MAX_REFERENCES) {
                overCeiling++;
                continue;
            }
            urls.add(normalized);
        }
        return new References(List.copyOf(urls), tags, withoutSrc, inlineData, insecure, duplicates,
                overCeiling);
    }

    private static String srcOf(String imgTag) {
        Matcher attribute = SRC_ATTR.matcher(imgTag);
        if (!attribute.find()) {
            return null;
        }
        for (int group = 1; group <= 3; group++) {
            String value = attribute.group(group);
            if (value != null) {
                return value.strip();
            }
        }
        return null;
    }

    /**
     * The reference as an https URL, or null when it is not one we may fetch.
     *
     * <p>A protocol-relative {@code //host/path} becomes https rather than being dropped: the page
     * was served over https, so that is what the browser resolves it to, and treating it as unknown
     * would drop real pictures. A plain {@code http://} is NOT upgraded — silently rewriting a
     * seller's URL to a scheme the CDN may not serve turns a refusal into a mystery.
     */
    private static String normalize(String raw) {
        String value = unescape(raw).strip();
        if (value.startsWith("//")) {
            return "https:" + value;
        }
        return value.toLowerCase(Locale.ROOT).startsWith("https://") ? value : null;
    }

    /** The five entities a markup {@code src} legitimately carries. Nothing else is interpreted. */
    private static String unescape(String value) {
        return value.replace("&amp;", "&").replace("&#38;", "&").replace("&quot;", "\"")
                .replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">");
    }
}
