package com.sellerops.product.detail.image;

import java.net.InetAddress;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * <b>The contract for reaching outside our own APIs</b> — a new egress class, kept as narrow as the
 * one thing it was approved for.
 *
 * <p>Every other HTTP client in this backend is bound to one channel's base URL and carries that
 * channel's credential. This one is different in kind: it takes a URL out of a document and fetches
 * it with no credential at all. That is the shape of a server-side request forgery, and the reason it
 * is acceptable here is not that the URL "comes from NAVER" — it is that <b>every one of the
 * conditions below is checked before a socket is opened</b>, and any of them failing is a refusal
 * rather than a fallback.
 *
 * <p><b>Refusing is always safe.</b> A refused image is one fewer picture in a census or one fewer
 * candidate for extraction. There is no path where being unable to fetch a banner harms a seller, so
 * every ambiguous case fails closed.
 *
 * <p><b>It is not a general URL fetcher and must not become one.</b> {@code DetailImageFetcher} is
 * the only caller, its input comes from {@link com.sellerops.product.detail.DetailImageReferences}
 * alone, and {@code DetailImageFetchBoundaryTest} asserts no other class in {@code main} constructs
 * it. A caller-supplied URL never reaches this.
 */
public final class ImageFetchPolicy {

    /** Only https. A CDN that will not serve https is a CDN we do not read. */
    public static final String SCHEME = "https";

    /** What an image response may claim to be. Anything else is refused unread. */
    public static final Set<String> CONTENT_TYPES = Set.of(
            "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/avif");

    /** One picture larger than this is refused. A 상세페이지 banner is far under it. */
    public static final int MAX_BYTES_PER_IMAGE = 8 * 1024 * 1024;

    /** The whole run's byte ceiling, so a bounded image count is also a bounded transfer. */
    public static final int MAX_BYTES_TOTAL = 96 * 1024 * 1024;

    /** How many images one product's fetch may ask for, whatever the page contains. */
    public static final int MAX_IMAGES_PER_PRODUCT = 26;

    /**
     * How many redirects are followed, each one re-checked from scratch.
     *
     * <p>Two, and manually — the JDK client's own redirect following is deliberately switched off,
     * because a policy that validates the first URL and lets the client chase the rest is a policy
     * that validates nothing. A redirect to {@code 127.0.0.1} is the classic bypass.
     */
    public static final int MAX_REDIRECTS = 2;

    public static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    public static final Duration READ_TIMEOUT = Duration.ofSeconds(15);

    private ImageFetchPolicy() {
    }

    /** Why a URL was refused, or {@link #ALLOWED}. A closed set, so a refusal is reportable. */
    public enum Verdict {
        ALLOWED,
        /** Not https — includes {@code http}, {@code data}, {@code file}, {@code ftp}. */
        SCHEME_REFUSED,
        /** No host, a bare IP literal we will not resolve, or an unparseable authority. */
        HOST_REFUSED,
        /** The name resolved, and it resolved to somewhere inside this network. */
        PRIVATE_ADDRESS_REFUSED,
        /** DNS said nothing. Unknown is refused, never retried into existence. */
        UNRESOLVABLE
    }

    /**
     * May this URL be fetched?
     *
     * <p>The resolution happens HERE and its result is what the caller must connect to — otherwise a
     * name that passes this check can resolve to something else a millisecond later (DNS rebinding).
     * {@link Resolved} carries the address that was actually approved.
     *
     * @param resolver how a hostname becomes addresses; the production one is
     *                 {@code InetAddress::getAllByName}, and a test supplies its own so the guard can
     *                 be proven without a network
     */
    public static Resolved check(String url, HostResolver resolver) {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (RuntimeException e) {
            return new Resolved(Verdict.HOST_REFUSED, null);
        }
        if (uri.getScheme() == null
                || !SCHEME.equalsIgnoreCase(uri.getScheme())) {
            return new Resolved(Verdict.SCHEME_REFUSED, null);
        }
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            // A URI whose authority the JDK could not parse (userinfo tricks, brackets) has no host
            // we can vouch for, and guessing one is how the check gets bypassed.
            return new Resolved(Verdict.HOST_REFUSED, null);
        }
        InetAddress[] addresses;
        try {
            addresses = resolver.resolve(host);
        } catch (Exception e) {
            return new Resolved(Verdict.UNRESOLVABLE, null);
        }
        if (addresses == null || addresses.length == 0) {
            return new Resolved(Verdict.UNRESOLVABLE, null);
        }
        // EVERY address, not the first: a host that answers with one public and one loopback address
        // is a host that can serve either, and approving it on the public one approves both.
        for (InetAddress address : addresses) {
            if (isPrivate(address)) {
                return new Resolved(Verdict.PRIVATE_ADDRESS_REFUSED, null);
            }
        }
        return new Resolved(Verdict.ALLOWED, addresses[0]);
    }

    /** The verdict, plus the address that was approved when it is {@link Verdict#ALLOWED}. */
    public record Resolved(Verdict verdict, InetAddress address) {

        public boolean allowed() {
            return verdict == Verdict.ALLOWED;
        }
    }

    /** How a hostname becomes addresses. Injected so the guard is testable without a network. */
    @FunctionalInterface
    public interface HostResolver {
        InetAddress[] resolve(String host) throws Exception;
    }

    /**
     * Is this address inside a network we must not reach?
     *
     * <p>Loopback, link-local, site-local, wildcard, multicast — and IPv6 unique-local
     * ({@code fc00::/7}), which {@code isSiteLocalAddress()} does not report. The list is written out
     * rather than delegated to one JDK predicate because no single one covers all of them, and the
     * gap is exactly where a metadata endpoint lives.
     */
    static boolean isPrivate(InetAddress address) {
        if (address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress()
                || address.isAnyLocalAddress() || address.isMulticastAddress()) {
            return true;
        }
        byte[] bytes = address.getAddress();
        if (bytes.length == 16 && (bytes[0] & 0xFE) == 0xFC) {
            return true;
        }
        if (bytes.length == 4) {
            int first = bytes[0] & 0xFF;
            int second = bytes[1] & 0xFF;
            // 100.64.0.0/10 (carrier NAT) and 169.254/16 are not "site local" to the JDK, and the
            // second is where cloud instance metadata answers.
            if (first == 100 && second >= 64 && second <= 127) {
                return true;
            }
            return first == 169 && second == 254;
        }
        return false;
    }

    /** Is this a content type we will accept bytes for? The parameters after {@code ;} are ignored. */
    public static boolean isImageContentType(String header) {
        if (header == null) {
            return false;
        }
        String type = header.split(";", 2)[0].strip().toLowerCase(Locale.ROOT);
        return CONTENT_TYPES.contains(type);
    }

    /** The headers this fetch sends. No cookie, no authorization, no api key, no referer. */
    public static List<String> forbiddenHeaderNames() {
        return List.of("authorization", "cookie", "x-api-key", "anthropic-version", "referer");
    }
}
