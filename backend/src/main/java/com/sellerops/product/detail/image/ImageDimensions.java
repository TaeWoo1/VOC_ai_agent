package com.sellerops.product.detail.image;

/**
 * Width and height read from an image's HEADER, without decoding it.
 *
 * <p>"Cheaply available" is the whole specification. {@code ImageIO.read} would decode every pixel of
 * a 26-image census to learn two integers, and a decoder is also the largest attack surface in this
 * lane — it parses attacker-influenceable bytes with a lot of native code behind it. So this reads the
 * first few dozen bytes of each format's header and gives up on anything it does not recognise.
 *
 * <p>Unknown is a normal answer, not a failure. A picture whose dimensions we could not read is still
 * counted, still hashed, and still a candidate.
 */
public final class ImageDimensions {

    private ImageDimensions() {
    }

    /** {@code null} when the format is unrecognised or the header is truncated. */
    public record Size(int width, int height) {
    }

    public static Size of(byte[] bytes) {
        if (bytes == null || bytes.length < 16) {
            return null;
        }
        Size png = png(bytes);
        if (png != null) {
            return png;
        }
        Size gif = gif(bytes);
        if (gif != null) {
            return gif;
        }
        Size webp = webp(bytes);
        if (webp != null) {
            return webp;
        }
        return jpeg(bytes);
    }

    /** PNG: the IHDR chunk is always first, so width and height sit at fixed offsets 16 and 20. */
    private static Size png(byte[] b) {
        if (b.length < 24 || (b[0] & 0xFF) != 0x89 || b[1] != 'P' || b[2] != 'N' || b[3] != 'G') {
            return null;
        }
        return new Size(int32(b, 16), int32(b, 20));
    }

    /** GIF: little-endian 16-bit logical screen size at offsets 6 and 8. */
    private static Size gif(byte[] b) {
        if (b.length < 10 || b[0] != 'G' || b[1] != 'I' || b[2] != 'F') {
            return null;
        }
        return new Size((b[6] & 0xFF) | ((b[7] & 0xFF) << 8), (b[8] & 0xFF) | ((b[9] & 0xFF) << 8));
    }

    /** WEBP: three sub-formats, and only the two whose header states the size outright. */
    private static Size webp(byte[] b) {
        if (b.length < 30 || b[0] != 'R' || b[1] != 'I' || b[2] != 'F' || b[3] != 'F'
                || b[8] != 'W' || b[9] != 'E' || b[10] != 'B' || b[11] != 'P') {
            return null;
        }
        if (b[15] == 'X') {
            // VP8X: 24-bit little-endian canvas size minus one, at offset 24.
            int width = ((b[24] & 0xFF) | ((b[25] & 0xFF) << 8) | ((b[26] & 0xFF) << 16)) + 1;
            int height = ((b[27] & 0xFF) | ((b[28] & 0xFF) << 8) | ((b[29] & 0xFF) << 16)) + 1;
            return new Size(width, height);
        }
        if (b[15] == 'L') {
            // VP8L: 14 bits each, packed from offset 21.
            int bits = (b[21] & 0xFF) | ((b[22] & 0xFF) << 8) | ((b[23] & 0xFF) << 16)
                    | ((b[24] & 0xFF) << 24);
            return new Size((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1);
        }
        return null;
    }

    /** JPEG: walk the marker segments to the first frame header, which carries the size. */
    private static Size jpeg(byte[] b) {
        if (b.length < 4 || (b[0] & 0xFF) != 0xFF || (b[1] & 0xFF) != 0xD8) {
            return null;
        }
        int i = 2;
        while (i + 9 < b.length) {
            if ((b[i] & 0xFF) != 0xFF) {
                i++;
                continue;
            }
            int marker = b[i + 1] & 0xFF;
            if (marker == 0xFF || marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
                i += 2;
                continue;
            }
            // SOF0..SOF15, minus the four that are not frame headers (DHT, JPG, DAC, and the
            // restart-interval markers already skipped above).
            if (marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC) {
                int height = ((b[i + 5] & 0xFF) << 8) | (b[i + 6] & 0xFF);
                int width = ((b[i + 7] & 0xFF) << 8) | (b[i + 8] & 0xFF);
                return width > 0 && height > 0 ? new Size(width, height) : null;
            }
            int length = ((b[i + 2] & 0xFF) << 8) | (b[i + 3] & 0xFF);
            if (length < 2) {
                return null;
            }
            i += 2 + length;
        }
        return null;
    }

    private static int int32(byte[] b, int at) {
        return ((b[at] & 0xFF) << 24) | ((b[at + 1] & 0xFF) << 16) | ((b[at + 2] & 0xFF) << 8)
                | (b[at + 3] & 0xFF);
    }
}
