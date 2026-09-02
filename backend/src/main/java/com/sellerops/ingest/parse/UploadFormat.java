package com.sellerops.ingest.parse;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * What an uploaded file <b>actually is</b>, decided by reading its first bytes rather than by trusting
 * the name it arrived under.
 *
 * <h2>Why the name could not stay authoritative</h2>
 *
 * <p>NAVER's Seller Center review export sends no filename in {@code Content-Disposition}. The browser
 * therefore saves it as a bare UUID — {@code f532f7b3-55e9-4f02-94db-78a4a78c3f2e}, no extension — and
 * that is the file a seller has in front of them. Measured on 2026-08-23: three such downloads, 39–65 KB,
 * every one a valid OOXML workbook.
 *
 * <p>Format was decided by {@code filename.endsWith(".xlsx")}, so the one file the manual import path
 * existed to accept was the one file it rejected. The guided path did not hit this only because the
 * runtime replaces the name with one of its own before uploading — which means the two paths were
 * deciding "what is this file" by different rules, and the fallback could not rescue what the primary
 * dropped. One detector, used by both, is the point of this class.
 *
 * <h2>What it does NOT do</h2>
 *
 * <p>This is not "accept anything and hope". A file must positively prove which of two shapes it is:
 * an OOXML workbook (ZIP local header <i>and</i> the OOXML content-types entry) or delimited text
 * (decodes as UTF-8, has a non-empty first line, and that line carries a delimiter). Anything else is
 * {@link #UNKNOWN} and is refused with the same message as before. A JPEG, a PDF, a bare ZIP of CSVs
 * and an empty file all land there.
 */
public enum UploadFormat {

    XLSX,
    CSV,
    UNKNOWN;

    /** ZIP local file header — every OOXML workbook starts with it. */
    private static final byte[] ZIP_LOCAL_HEADER = {0x50, 0x4b, 0x03, 0x04};

    /**
     * The OOXML marker. A ZIP alone is not a workbook, and accepting one would let an arbitrary archive
     * reach POI. Every OOXML package contains this entry, and a zip stores each entry's name literally in
     * its local header, so finding the bytes proves the package declares one.
     *
     * <p><b>It is not necessarily the FIRST entry.</b> This class used to say it was — "appears in the first
     * local file header of every workbook Excel writes" — and that assumption cost a live guided import on
     * 2026-09-02: NAVER's Seller Center export is a perfectly valid workbook with nine entries whose FIRST
     * entry is {@code xl/worksheets/sheet1.xml}, so the marker's local header sits 15,413 bytes in. The run
     * had walked the seller through the whole export and was refused at the last step with "지원하지 않는 파일
     * 형식입니다" — about a file Excel opens.
     */
    private static final byte[] OOXML_CONTENT_TYPES =
            "[Content_Types].xml".getBytes(StandardCharsets.US_ASCII);

    /** How far in we look. Generous enough for the zip directory preamble, bounded so a huge upload costs nothing. */
    static final int SNIFF_BYTES = 8 * 1024;

    /**
     * How far into a ZIP we look for the OOXML marker.
     *
     * <p>Only spent on a file that has already proven it is a zip, and only until the marker is found. Large
     * enough that entry ORDER stops being an assumption (the observed export needed 15 KB, and a workbook
     * with a big first sheet needs more), bounded so an arbitrary 2 GB archive still costs a fixed read.
     */
    static final int ZIP_SNIFF_BYTES = 1024 * 1024;

    /** Delimiters a header row may legitimately use. A single column with none of these is not a table. */
    private static final char[] DELIMITERS = {',', ';', '\t'};

    /**
     * Read at most {@link #SNIFF_BYTES} from {@code in} and say what it is. The stream must support
     * {@code mark}/{@code reset} ({@link BufferedInputStream} does) — it is rewound, so the caller parses
     * the same bytes afterwards.
     */
    public static UploadFormat detect(BufferedInputStream in) throws IOException {
        // Marked for the larger window up front: the buffer only grows as bytes are actually read, so a CSV
        // still costs one 8 KB read and only a zip pays for the longer look.
        in.mark(ZIP_SNIFF_BYTES + 1);
        byte[] head = in.readNBytes(SNIFF_BYTES);
        if (startsWith(head, ZIP_LOCAL_HEADER)) {
            byte[] rest = in.readNBytes(Math.max(0, ZIP_SNIFF_BYTES - head.length));
            in.reset();
            byte[] both = Arrays.copyOf(head, head.length + rest.length);
            System.arraycopy(rest, 0, both, head.length, rest.length);
            return zipFormat(both);
        }
        in.reset();
        return of(head);
    }

    /** The pure decision, so it is testable without a stream. */
    public static UploadFormat of(byte[] head) {
        if (head == null || head.length == 0) {
            return UNKNOWN;
        }
        if (startsWith(head, ZIP_LOCAL_HEADER)) {
            return zipFormat(head);
        }
        return looksLikeDelimitedText(head) ? CSV : UNKNOWN;
    }

    /** A zip is a workbook only if it declares the OOXML content types. Otherwise UNKNOWN — never POI. */
    private static UploadFormat zipFormat(byte[] prefix) {
        return contains(prefix, OOXML_CONTENT_TYPES) ? XLSX : UNKNOWN;
    }

    /**
     * Delimited text, judged conservatively: it must decode as strict UTF-8 (a BOM is fine), its first
     * non-empty line must exist, and that line must carry a delimiter. A prose file, a binary blob and a
     * single bare word all fail — the header row of a real export never does.
     *
     * <p>Strict decoding is what keeps a JPEG out: its bytes are not valid UTF-8, and a lenient decode
     * would have turned them into replacement characters and called it text.
     */
    private static boolean looksLikeDelimitedText(byte[] head) {
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(truncateToCharBoundary(head)))
                    .toString();
        } catch (CharacterCodingException e) {
            return false;
        }
        if (text.indexOf('\0') >= 0) {
            return false; // NUL bytes decode fine but never occur in a delimited export.
        }
        String firstLine = text.lines().filter(l -> !l.isBlank()).findFirst().orElse("");
        if (firstLine.isBlank()) {
            return false;
        }
        for (char delimiter : DELIMITERS) {
            if (firstLine.indexOf(delimiter) >= 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * The sniff window can cut a multi-byte character in half, which strict decoding would report as
     * malformed — a real UTF-8 file misjudged because we stopped reading mid-character. Drop any trailing
     * bytes that are part of an incomplete sequence.
     */
    private static byte[] truncateToCharBoundary(byte[] head) {
        int end = head.length;
        for (int back = 0; back < 4 && end > 0; back++) {
            int b = head[end - 1] & 0xFF;
            if (b < 0x80) {
                return Arrays.copyOf(head, end); // ASCII byte: a clean boundary.
            }
            if (b >= 0xC0) {
                return Arrays.copyOf(head, end - 1); // A lead byte with its continuation cut off.
            }
            end--; // A continuation byte; keep walking back to its lead.
        }
        return Arrays.copyOf(head, Math.max(end, 0));
    }

    private static boolean startsWith(byte[] head, byte[] prefix) {
        if (head.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (head[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private static boolean contains(byte[] head, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= head.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (head[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return true;
        }
        return false;
    }
}
