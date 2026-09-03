package com.sellerops.knowledge.document;

import com.sellerops.common.ApiException;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.extractor.XWPFWordExtractor;
import org.apache.poi.xwpf.usermodel.XWPFDocument;

/**
 * <b>Read a seller's own document as text, or refuse it by name.</b>
 * (Knowledge Sources &amp; Acquisition v1, 2026-09-03)
 *
 * <p>A manual, an FAQ, a shipping policy — the seller already wrote these, and asking them to retype
 * one into a form is asking them to do work they already did. What this does is exactly the mechanical
 * part: bytes to characters. It runs no model, makes no judgement about what the document means, and
 * splits nothing into knowledge — the existing {@code KnowledgeText.chunk} does that afterwards, the
 * same way it does for a typed document.
 *
 * <p><b>An allow-list, not a sniffer.</b> The extension decides, and an unknown one is refused with a
 * sentence naming what can be read. Guessing a format from bytes is how a renamed executable becomes
 * an "import"; and a refusal a seller can read ("PDF, DOCX, TXT를 읽을 수 있습니다") is more useful than
 * a parser failing three layers down.
 *
 * <p><b>Two bounds, and both are the seller's protection rather than ours.</b> {@link #MAX_BYTES} keeps
 * one upload from becoming the org's whole corpus; {@link #MAX_CHARS} keeps a 400-page catalogue from
 * turning into ten thousand passages that drown every real answer. Over either, the import is refused
 * and says which — never silently truncated, because a manual missing its second half is a manual that
 * answers half the questions confidently and the rest with silence.
 *
 * <p><b>A document with no text layer is refused, not accepted empty.</b> A scanned PDF is a stack of
 * pictures; reading it would need the image lane, which is a separate product decision with its own
 * payload floor ({@code docs/image_product_knowledge_v1.md}). Accepting it as an empty source would put
 * a document on the seller's screen that can never grounding anything and never say why.
 */
public final class KnowledgeDocumentText {

    /** The largest file this accepts. Ten megabytes is a long manual and a short catalogue. */
    public static final int MAX_BYTES = 10 * 1024 * 1024;

    /** The most characters one document may contribute. Roughly a 150-page manual. */
    public static final int MAX_CHARS = 300_000;

    /** The fewest characters that count as a document rather than a blank page or a scan. */
    public static final int MIN_CHARS = 20;

    /** What a seller may hand over, by extension. Everything else is refused by name. */
    public static final List<String> ACCEPTED = List.of("pdf", "docx", "txt", "md", "csv");

    private KnowledgeDocumentText() {
    }

    /** The refusal sentence, written once so every caller says the same thing. */
    public static String acceptedListKo() {
        return "PDF · DOCX · TXT · MD · CSV 파일을 읽을 수 있습니다.";
    }

    /** The extension, lower-cased, or empty when the name carries none. */
    public static String extensionOf(String filename) {
        if (filename == null) {
            return "";
        }
        int dot = filename.lastIndexOf('.');
        return dot < 0 || dot == filename.length() - 1 ? ""
                : filename.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /**
     * Extract the document's text.
     *
     * @throws ApiException 400 with a seller-readable reason — unknown format, too large, no text
     */
    public static String extract(String filename, byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            throw ApiException.badRequest("파일이 비어 있습니다.");
        }
        if (bytes.length > MAX_BYTES) {
            throw ApiException.badRequest("파일이 너무 큽니다 (최대 10MB).");
        }
        String extension = extensionOf(filename);
        if (!ACCEPTED.contains(extension)) {
            throw ApiException.badRequest("이 형식은 읽을 수 없습니다. " + acceptedListKo());
        }
        String text = switch (extension) {
            case "pdf" -> fromPdf(bytes);
            case "docx" -> fromDocx(bytes);
            default -> new String(bytes, StandardCharsets.UTF_8);
        };
        String normalized = normalize(text);
        if (normalized.length() < MIN_CHARS) {
            throw ApiException.badRequest(
                    "이 파일에서 읽을 수 있는 글자가 거의 없습니다. 스캔한 이미지 문서라면 아직 읽지 못합니다.");
        }
        if (normalized.length() > MAX_CHARS) {
            throw ApiException.badRequest(
                    "이 문서가 너무 깁니다. 자료를 나누어 올려 주세요 (한 파일 최대 30만 자).");
        }
        return normalized;
    }

    /**
     * Blank lines collapsed, trailing spaces gone, CRLF normalized.
     *
     * <p>Deliberately gentle: paragraph breaks SURVIVE, because {@code KnowledgeText.chunk} reads them
     * to decide where one passage ends. A whitespace-flattening pass here would hand the chunker one
     * enormous line and every passage would be an arbitrary cut.
     */
    static String normalize(String text) {
        return text == null ? "" : text
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                .replaceAll("[ \\t\\u00A0]+", " ")
                .replaceAll(" *\n *", "\n")
                .replaceAll("\n{3,}", "\n\n")
                .strip();
    }

    private static String fromPdf(byte[] bytes) {
        try (PDDocument document = Loader.loadPDF(bytes)) {
            if (document.isEncrypted()) {
                throw ApiException.badRequest("암호가 걸린 PDF는 읽을 수 없습니다.");
            }
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            return stripper.getText(document);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            // The exception TYPE only. A parser message can quote the document's own bytes.
            throw ApiException.badRequest("PDF를 읽지 못했습니다 (" + e.getClass().getSimpleName() + ").");
        }
    }

    private static String fromDocx(byte[] bytes) {
        try (InputStream in = new ByteArrayInputStream(bytes);
             XWPFDocument document = new XWPFDocument(in);
             XWPFWordExtractor extractor = new XWPFWordExtractor(document)) {
            return extractor.getText();
        } catch (Exception e) {
            throw ApiException.badRequest("DOCX를 읽지 못했습니다 (" + e.getClass().getSimpleName() + ").");
        }
    }
}
