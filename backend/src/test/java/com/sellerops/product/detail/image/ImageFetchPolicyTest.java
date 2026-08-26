package com.sellerops.product.detail.image;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetAddress;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The SSRF guard, asserted rather than described.
 *
 * <p>This is the one place in the backend where a URL taken out of a document is fetched with no
 * credential, and every case below is a way that has historically gone wrong somewhere. Refusal is
 * the safe direction: a refused picture costs a census one row.
 */
class ImageFetchPolicyTest {

    private static final ImageFetchPolicy.HostResolver PUBLIC =
            host -> new InetAddress[] {InetAddress.getByName("93.184.216.34")};

    @Nested
    @DisplayName("where we will not go")
    class Refusals {

        @Test
        @DisplayName("only https — http, data, file and ftp are refused before a socket exists")
        void schemeIsRefused() {
            for (String url : new String[] {"http://cdn.example.com/a.jpg",
                "file:///etc/passwd", "ftp://cdn.example.com/a.jpg", "data:image/png;base64,AA"}) {
                assertThat(ImageFetchPolicy.check(url, PUBLIC).verdict())
                        .as(url).isEqualTo(ImageFetchPolicy.Verdict.SCHEME_REFUSED);
            }
        }

        @Test
        @DisplayName("loopback, link-local, site-local and the metadata address are refused")
        void privateAddressesAreRefused() throws Exception {
            String[] blocked = {"127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.9.9",
                "169.254.169.254", "100.64.0.1", "0.0.0.0"};
            for (String ip : blocked) {
                InetAddress address = InetAddress.getByName(ip);
                assertThat(ImageFetchPolicy.isPrivate(address)).as(ip).isTrue();
                assertThat(ImageFetchPolicy.check("https://cdn.example.com/a.jpg",
                                host -> new InetAddress[] {address}).verdict())
                        .as(ip).isEqualTo(ImageFetchPolicy.Verdict.PRIVATE_ADDRESS_REFUSED);
            }
        }

        @Test
        @DisplayName("IPv6 loopback and unique-local are refused too")
        void ipv6PrivateIsRefused() throws Exception {
            for (String ip : new String[] {"::1", "fc00::1", "fd12:3456::1", "fe80::1"}) {
                assertThat(ImageFetchPolicy.isPrivate(InetAddress.getByName(ip))).as(ip).isTrue();
            }
        }

        @Test
        @DisplayName("a host that resolves to one public AND one private address is refused whole")
        void anyPrivateAddressPoisonsTheHost() throws Exception {
            var mixed = new InetAddress[] {
                InetAddress.getByName("93.184.216.34"), InetAddress.getByName("127.0.0.1")};
            assertThat(ImageFetchPolicy.check("https://cdn.example.com/a.jpg", host -> mixed).verdict())
                    .as("a host that can answer with either can serve either")
                    .isEqualTo(ImageFetchPolicy.Verdict.PRIVATE_ADDRESS_REFUSED);
        }

        @Test
        @DisplayName("an unresolvable name is refused, never retried into existence")
        void unresolvableIsRefused() {
            assertThat(ImageFetchPolicy.check("https://cdn.example.com/a.jpg", host -> {
                throw new java.net.UnknownHostException(host);
            }).verdict()).isEqualTo(ImageFetchPolicy.Verdict.UNRESOLVABLE);
            assertThat(ImageFetchPolicy.check("https://cdn.example.com/a.jpg",
                    host -> new InetAddress[0]).verdict())
                    .isEqualTo(ImageFetchPolicy.Verdict.UNRESOLVABLE);
        }

        @Test
        @DisplayName("a URL with no parseable host is refused rather than guessed at")
        void hostlessIsRefused() {
            for (String url : new String[] {"https://", "not a url at all", "https:///a.jpg"}) {
                assertThat(ImageFetchPolicy.check(url, PUBLIC).allowed()).as(url).isFalse();
            }
        }
    }

    @Nested
    @DisplayName("what we will accept")
    class Acceptance {

        @Test
        @DisplayName("a public https host is allowed, and the approved address comes back with it")
        void publicHttpsIsAllowed() {
            var resolved = ImageFetchPolicy.check("https://cdn.example.com/a.jpg", PUBLIC);
            assertThat(resolved.allowed()).isTrue();
            assertThat(resolved.address()).isNotNull();
        }

        @Test
        @DisplayName("only image content types, and the charset parameter is ignored")
        void contentTypes() {
            assertThat(ImageFetchPolicy.isImageContentType("image/jpeg")).isTrue();
            assertThat(ImageFetchPolicy.isImageContentType("IMAGE/PNG; charset=binary")).isTrue();
            assertThat(ImageFetchPolicy.isImageContentType("text/html")).isFalse();
            assertThat(ImageFetchPolicy.isImageContentType("application/octet-stream")).isFalse();
            assertThat(ImageFetchPolicy.isImageContentType(null)).isFalse();
        }

        @Test
        @DisplayName("the caps are bounded, and the redirect budget is small")
        void theCapsAreReal() {
            assertThat(ImageFetchPolicy.MAX_BYTES_PER_IMAGE).isLessThanOrEqualTo(16 * 1024 * 1024);
            assertThat(ImageFetchPolicy.MAX_IMAGES_PER_PRODUCT).isLessThanOrEqualTo(26);
            assertThat(ImageFetchPolicy.MAX_REDIRECTS).isLessThanOrEqualTo(3);
            assertThat(ImageFetchPolicy.CONNECT_TIMEOUT.toSeconds()).isLessThanOrEqualTo(10);
            assertThat(ImageFetchPolicy.READ_TIMEOUT.toSeconds()).isLessThanOrEqualTo(30);
        }
    }
}
