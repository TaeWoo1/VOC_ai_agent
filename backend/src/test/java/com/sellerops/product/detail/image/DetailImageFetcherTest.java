package com.sellerops.product.detail.image;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class DetailImageFetcherTest {

    private static final ImageFetchPolicy.HostResolver PUBLIC =
            host -> new InetAddress[] {InetAddress.getByName("93.184.216.34")};
    private static final ImageFetchPolicy.HostResolver LOOPBACK =
            host -> new InetAddress[] {InetAddress.getByName("127.0.0.1")};

    /** A 1×1 PNG, so the header reader has something real to parse. */
    private static byte[] png(int width, int height) {
        byte[] b = new byte[64];
        b[0] = (byte) 0x89;
        b[1] = 'P';
        b[2] = 'N';
        b[3] = 'G';
        for (int i = 0; i < 4; i++) {
            b[16 + i] = (byte) (width >> (24 - 8 * i));
            b[20 + i] = (byte) (height >> (24 - 8 * i));
        }
        return b;
    }

    /**
     * A stubbed response, built ONE at a time and never inside a {@code thenReturn(...)} argument —
     * nesting one mock's stubbing inside another's is what Mockito calls unfinished stubbing.
     */
    @SuppressWarnings("unchecked")
    private static HttpResponse<InputStream> response(int status, Map<String, List<String>> headers,
                                                      byte[] body) {
        HttpResponse<InputStream> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(status);
        when(response.headers()).thenReturn(HttpHeaders.of(headers, (k, v) -> true));
        when(response.body()).thenReturn(new ByteArrayInputStream(body));
        return response;
    }

    /**
     * Stub the client to answer with a FRESH response every call.
     *
     * <p>A single mocked response cannot serve two calls: its body is a stream and the first read
     * exhausts it, so the second fetch would see an empty picture and hash the empty string.
     */
    @SuppressWarnings("unchecked")
    private static void answering(HttpClient client, int status, Map<String, List<String>> headers,
                                  byte[] body) throws Exception {
        when(client.send(any(HttpRequest.class), any()))
                .thenAnswer(invocation -> response(status, headers, body));
    }

    private static Map<String, List<String>> imageHeaders() {
        return Map.of("content-type", List.of("image/png"));
    }

    @Test
    @DisplayName("a picture becomes a hash, a size and its dimensions — and the bytes are dropped")
    void readsAPicture() throws Exception {
        HttpClient client = mock(HttpClient.class);
        answering(client, 200, imageHeaders(), png(860, 1200));

        FetchedImage image = new DetailImageFetcher(client, PUBLIC)
                .fetchOne("https://cdn.example.com/a.png", 0);

        assertThat(image.ok()).isTrue();
        assertThat(image.sha256()).hasSize(64).matches("[0-9a-f]+");
        assertThat(image.byteSize()).isEqualTo(64);
        assertThat(image.width()).isEqualTo(860);
        assertThat(image.height()).isEqualTo(1200);
        assertThat(FetchedImage.class.getRecordComponents())
                .as("the record cannot carry the URL or the bytes")
                .noneSatisfy(c -> assertThat(c.getName()).isIn("url", "bytes", "content"));
    }

    @Test
    @DisplayName("the same bytes at two addresses are one picture — identity is content, not URL")
    void identityIsContent() throws Exception {
        HttpClient client = mock(HttpClient.class);
        answering(client, 200, imageHeaders(), png(100, 100));

        DetailImageFetcher fetcher = new DetailImageFetcher(client, PUBLIC);
        List<FetchedImage> both = fetcher.fetchAll(
                List.of("https://cdn.example.com/a.png?v=1", "https://cdn.example.com/a.png?v=2"), 5);

        assertThat(both).allMatch(FetchedImage::ok);
        assertThat(both.get(0).sha256()).isEqualTo(both.get(1).sha256());
    }

    @Test
    @DisplayName("a private address is refused with no request at all")
    void privateAddressMakesNoRequest() throws Exception {
        HttpClient client = mock(HttpClient.class);
        FetchedImage image = new DetailImageFetcher(client, LOOPBACK)
                .fetchOne("https://cdn.example.com/a.png", 0);

        assertThat(image.outcome()).isEqualTo(FetchedImage.Outcome.REFUSED_PRIVATE_ADDRESS);
        org.mockito.Mockito.verify(client, org.mockito.Mockito.never()).send(any(), any());
    }

    @Test
    @DisplayName("a redirect to a private address is refused — the classic bypass")
    void redirectsAreRevalidated() throws Exception {
        List<String> resolvedHosts = new ArrayList<>();
        ImageFetchPolicy.HostResolver resolver = host -> {
            resolvedHosts.add(host);
            return new InetAddress[] {
                InetAddress.getByName(host.equals("cdn.example.com") ? "93.184.216.34" : "127.0.0.1")};
        };
        HttpClient client = mock(HttpClient.class);
        answering(client, 302, Map.of("location", List.of("https://internal.example.com/a.png")),
                new byte[0]);

        FetchedImage image = new DetailImageFetcher(client, resolver)
                .fetchOne("https://cdn.example.com/a.png", 0);

        assertThat(image.outcome()).isEqualTo(FetchedImage.Outcome.REFUSED_PRIVATE_ADDRESS);
        assertThat(resolvedHosts).as("the redirect target was checked, not trusted")
                .containsExactly("cdn.example.com", "internal.example.com");
    }

    @Test
    @DisplayName("a redirect loop ends, it does not spin")
    void redirectsAreBounded() throws Exception {
        HttpClient client = mock(HttpClient.class);
        answering(client, 302, Map.of("location", List.of("https://cdn.example.com/b.png")),
                new byte[0]);

        assertThat(new DetailImageFetcher(client, PUBLIC)
                .fetchOne("https://cdn.example.com/a.png", 0).outcome())
                .isEqualTo(FetchedImage.Outcome.TOO_MANY_REDIRECTS);
    }

    @Test
    @DisplayName("HTML wearing an image URL is refused unread")
    void nonImageContentIsRefused() throws Exception {
        HttpClient client = mock(HttpClient.class);
        answering(client, 200, Map.of("content-type", List.of("text/html")), "<html>".getBytes());

        assertThat(new DetailImageFetcher(client, PUBLIC)
                .fetchOne("https://cdn.example.com/a.png", 0).outcome())
                .isEqualTo(FetchedImage.Outcome.NOT_AN_IMAGE);
    }

    @Test
    @DisplayName("a body larger than the cap is abandoned while streaming, not after")
    void oversizeIsRefused() throws Exception {
        HttpClient client = mock(HttpClient.class);
        answering(client, 200, imageHeaders(), new byte[ImageFetchPolicy.MAX_BYTES_PER_IMAGE + 1024]);

        assertThat(new DetailImageFetcher(client, PUBLIC)
                .fetchOne("https://cdn.example.com/a.png", 0).outcome())
                .isEqualTo(FetchedImage.Outcome.TOO_LARGE);
    }

    @Test
    @DisplayName("references past the budget are reported, never silently absent")
    void budgetIsReportedNotHidden() throws Exception {
        HttpClient client = mock(HttpClient.class);
        answering(client, 200, imageHeaders(), png(10, 10));

        List<FetchedImage> fetched = new DetailImageFetcher(client, PUBLIC).fetchAll(
                List.of("https://cdn.example.com/1.png", "https://cdn.example.com/2.png",
                        "https://cdn.example.com/3.png"), 1);

        assertThat(fetched).hasSize(3);
        assertThat(fetched.get(0).ok()).isTrue();
        assertThat(fetched.subList(1, 3))
                .as("a census that reports 1 image for a page with 3 has said something false")
                .allMatch(i -> i.outcome() == FetchedImage.Outcome.BUDGET_EXHAUSTED);
    }
}
