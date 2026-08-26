package com.sellerops.product.detail.image;

import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/**
 * Fetch the seller's own 상세페이지 pictures, under {@link ImageFetchPolicy} and nothing else.
 *
 * <p><b>The one credential-free egress in this backend.</b> Every other HTTP client here speaks to a
 * channel API with that channel's key. This one opens an anonymous connection to whatever CDN the
 * seller's markup pointed at, which is why the policy is checked before a socket exists and re-checked
 * after every redirect, and why the JDK client's own redirect following is switched OFF — a check
 * that validates the first hop and lets the client chase the rest validates nothing.
 *
 * <p><b>Bytes are hashed and dropped.</b> Nothing here returns, stores, logs or forwards image
 * content. What leaves is {@link FetchedImage}: a content hash, a size, a declared type and — when
 * the header states it cheaply — the dimensions. The seller's picture does not exist in this process
 * after the method returns.
 *
 * <p><b>Refusal is the safe direction and every branch takes it.</b> A wrong content type, an
 * oversized body, a redirect loop, a failed name lookup — all become an outcome on the record, none
 * becomes an exception the caller has to interpret, and none becomes a retry.
 */
public class DetailImageFetcher {

    private final HttpClient client;
    private final ImageFetchPolicy.HostResolver resolver;

    public DetailImageFetcher() {
        this(HttpClient.newBuilder()
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .connectTimeout(ImageFetchPolicy.CONNECT_TIMEOUT)
                        .build(),
                InetAddress::getAllByName);
    }

    DetailImageFetcher(HttpClient client, ImageFetchPolicy.HostResolver resolver) {
        this.client = client;
        this.resolver = resolver;
    }

    /**
     * Fetch up to {@code maxImages} of these references, stopping at the run's total byte ceiling.
     *
     * <p>References beyond the cap are NOT silently absent: they come back as
     * {@link FetchedImage.Outcome#BUDGET_EXHAUSTED} rows, because a census that reports "12 images"
     * for a page with 26 has told the reader something false.
     */
    public List<FetchedImage> fetchAll(List<String> urls, int maxImages) {
        List<FetchedImage> out = new ArrayList<>();
        if (urls == null || urls.isEmpty()) {
            return out;
        }
        int allowed = Math.max(0, Math.min(maxImages, ImageFetchPolicy.MAX_IMAGES_PER_PRODUCT));
        long totalBytes = 0;
        for (int i = 0; i < urls.size(); i++) {
            if (i >= allowed || totalBytes >= ImageFetchPolicy.MAX_BYTES_TOTAL) {
                out.add(FetchedImage.failed(i, FetchedImage.Outcome.BUDGET_EXHAUSTED));
                continue;
            }
            FetchedImage fetched = fetchOne(urls.get(i), i);
            totalBytes += fetched.byteSize();
            out.add(fetched);
        }
        return List.copyOf(out);
    }

    /**
     * One picture WITH its bytes, for the one caller that has to send them somewhere.
     *
     * <p>Separate from {@link #fetchAll} rather than a flag on it, so that the census path — and any
     * future counting path — cannot accidentally start holding image content. The default is still
     * "hash it and drop it"; retaining is something a caller has to ask for by name.
     *
     * <p>The bytes are bounded by {@link ImageFetchPolicy#MAX_BYTES_PER_IMAGE} exactly as before,
     * enforced while streaming, and they are never logged, stored, or returned to anything but the
     * extraction generator.
     */
    public Loaded loadOne(String url, int ordinal) {
        return fetchOne(url, ordinal, true);
    }

    /** A picture and its content, held only for as long as one model call takes. */
    public record Loaded(FetchedImage meta, byte[] bytes) {

        public boolean ok() {
            return meta.ok() && bytes != null && bytes.length > 0;
        }
    }

    /** One picture, one policy check per hop. */
    FetchedImage fetchOne(String url, int ordinal) {
        return fetchOne(url, ordinal, false).meta();
    }

    private Loaded fetchOne(String url, int ordinal, boolean retain) {
        String target = url;
        for (int hop = 0; hop <= ImageFetchPolicy.MAX_REDIRECTS; hop++) {
            ImageFetchPolicy.Resolved resolved = ImageFetchPolicy.check(target, resolver);
            if (!resolved.allowed()) {
                return dropped(ordinal, refusalOf(resolved.verdict()));
            }
            HttpResponse<InputStream> response;
            try {
                response = client.send(request(target), HttpResponse.BodyHandlers.ofInputStream());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return dropped(ordinal, FetchedImage.Outcome.TRANSPORT_FAILED);
            } catch (Exception e) {
                // The type never travels either: a TLS or DNS message can name the host.
                return dropped(ordinal, FetchedImage.Outcome.TRANSPORT_FAILED);
            }
            int status = response.statusCode();
            if (status >= 300 && status < 400) {
                String location = response.headers().firstValue("location").orElse(null);
                if (location == null || location.isBlank()) {
                    return dropped(ordinal, FetchedImage.Outcome.HTTP_ERROR);
                }
                // Resolved against the CURRENT target so a relative Location works, then re-checked
                // from scratch at the top of the loop. This is the hop where an SSRF gets in.
                try {
                    target = URI.create(target).resolve(location.strip()).toString();
                } catch (RuntimeException e) {
                    return dropped(ordinal, FetchedImage.Outcome.REFUSED_HOST);
                }
                closeQuietly(response.body());
                continue;
            }
            if (status != 200) {
                closeQuietly(response.body());
                return dropped(ordinal, FetchedImage.Outcome.HTTP_ERROR);
            }
            String contentType = response.headers().firstValue("content-type").orElse(null);
            if (!ImageFetchPolicy.isImageContentType(contentType)) {
                closeQuietly(response.body());
                return dropped(ordinal, FetchedImage.Outcome.NOT_AN_IMAGE);
            }
            return read(response.body(), ordinal, contentType, retain);
        }
        return dropped(ordinal, FetchedImage.Outcome.TOO_MANY_REDIRECTS);
    }

    private static Loaded dropped(int ordinal, FetchedImage.Outcome outcome) {
        return new Loaded(FetchedImage.failed(ordinal, outcome), null);
    }

    /**
     * Read the body under the per-image cap, hashing as it goes.
     *
     * <p>The cap is enforced while streaming rather than checked against {@code Content-Length}: a
     * server is free to lie about the length, and a body handler that materialises first and measures
     * second has already spent the memory it was supposed to bound. Only the first
     * {@link Header#PREFIX} bytes are retained, for the dimension read; everything else is hashed and
     * discarded.
     */
    private Loaded read(InputStream body, int ordinal, String contentType, boolean retain) {
        try (InputStream in = body) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] head = new byte[Header.PREFIX];
            int headFilled = 0;
            // Only allocated when a caller asked for the content. The counting path never grows one.
            java.io.ByteArrayOutputStream retained = retain ? new java.io.ByteArrayOutputStream() : null;
            byte[] buffer = new byte[8192];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > ImageFetchPolicy.MAX_BYTES_PER_IMAGE) {
                    return dropped(ordinal, FetchedImage.Outcome.TOO_LARGE);
                }
                digest.update(buffer, 0, read);
                if (retained != null) {
                    retained.write(buffer, 0, read);
                }
                if (headFilled < head.length) {
                    int copy = Math.min(read, head.length - headFilled);
                    System.arraycopy(buffer, 0, head, headFilled, copy);
                    headFilled += copy;
                }
            }
            byte[] prefix = headFilled == head.length ? head : java.util.Arrays.copyOf(head, headFilled);
            ImageDimensions.Size size = ImageDimensions.of(prefix);
            FetchedImage meta = new FetchedImage(ordinal, FetchedImage.Outcome.OK,
                    HexFormat.of().formatHex(digest.digest()), (int) total, normalizeType(contentType),
                    size == null ? 0 : size.width(), size == null ? 0 : size.height());
            return new Loaded(meta, retained == null ? null : retained.toByteArray());
        } catch (Exception e) {
            return dropped(ordinal, FetchedImage.Outcome.TRANSPORT_FAILED);
        }
    }

    /** How much of the front of a file is kept in order to read its header. */
    private static final class Header {
        static final int PREFIX = 4096;
    }

    private static HttpRequest request(String url) {
        // No cookie, no authorization, no referer, no api key — see ImageFetchPolicy. Accept states
        // what we will take, so a server that would negotiate HTML says so before sending it.
        return HttpRequest.newBuilder(URI.create(url))
                .timeout(ImageFetchPolicy.READ_TIMEOUT)
                .header("Accept", "image/*")
                .GET()
                .build();
    }

    private static FetchedImage.Outcome refusalOf(ImageFetchPolicy.Verdict verdict) {
        return switch (verdict) {
            case SCHEME_REFUSED -> FetchedImage.Outcome.REFUSED_SCHEME;
            case HOST_REFUSED -> FetchedImage.Outcome.REFUSED_HOST;
            case PRIVATE_ADDRESS_REFUSED -> FetchedImage.Outcome.REFUSED_PRIVATE_ADDRESS;
            case UNRESOLVABLE -> FetchedImage.Outcome.UNRESOLVABLE;
            case ALLOWED -> throw new IllegalStateException("not a refusal");
        };
    }

    private static String normalizeType(String header) {
        return header == null ? null : header.split(";", 2)[0].strip().toLowerCase(java.util.Locale.ROOT);
    }

    private static void closeQuietly(InputStream stream) {
        try {
            stream.close();
        } catch (Exception ignored) {
            // A body we are abandoning. Nothing downstream depends on it closing cleanly.
        }
    }
}
