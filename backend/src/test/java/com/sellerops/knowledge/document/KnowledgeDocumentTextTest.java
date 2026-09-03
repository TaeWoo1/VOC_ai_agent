package com.sellerops.knowledge.document;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import java.nio.charset.StandardCharsets;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import java.io.ByteArrayOutputStream;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Knowledge Sources &amp; Acquisition v1 — bytes to characters, or a refusal a seller can read.
 *
 * <p>The refusals matter more than the successes here. A format nobody can read, a scan with no text
 * layer, and a file too big to be one document are three different problems with three different
 * things for the seller to do, and a parser failing three layers down says none of them.
 */
class KnowledgeDocumentTextTest {

    @Test
    @DisplayName("a plain text manual comes through, paragraph breaks intact")
    void plainText() {
        String body = "배송 기준\n\n오후 2시 이전 결제 건은 당일 출고합니다.\n주말과 공휴일은 출고하지 않습니다.";
        String text = KnowledgeDocumentText.extract("배송정책.txt", body.getBytes(StandardCharsets.UTF_8));
        assertThat(text).contains("당일 출고합니다");
        // The chunker reads blank lines to find passage boundaries; flattening them here would hand it
        // one enormous line and every passage would be an arbitrary cut.
        assertThat(text).contains("\n\n");
    }

    @Test
    @DisplayName("a DOCX comes through as its paragraphs")
    void docx() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (XWPFDocument document = new XWPFDocument()) {
            document.createParagraph().createRun().setText("교환 및 반품 안내");
            document.createParagraph().createRun().setText("수령 후 7일 이내에 교환하실 수 있습니다.");
            document.write(out);
        }
        String text = KnowledgeDocumentText.extract("교환반품.docx", out.toByteArray());
        assertThat(text).contains("수령 후 7일 이내에 교환하실 수 있습니다.");
    }

    @Test
    @DisplayName("a PDF with a text layer comes through")
    void pdf() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (PDDocument document = new PDDocument()) {
            PDPage page = new PDPage();
            document.addPage(page);
            try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                content.beginText();
                content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                content.newLineAtOffset(50, 700);
                content.showText("Remove dust and oil from the surface before attaching.");
                content.endText();
            }
            document.save(out);
        }
        String text = KnowledgeDocumentText.extract("manual.pdf", out.toByteArray());
        assertThat(text).contains("Remove dust and oil from the surface");
    }

    @Test
    @DisplayName("an unknown format is refused by name, and the refusal says what can be read")
    void unknownFormatIsRefusedByName() {
        assertThatThrownBy(() -> KnowledgeDocumentText.extract("manual.hwp", "내용".repeat(50).getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("PDF");
    }

    @Test
    @DisplayName("a document with no readable text is refused rather than accepted empty")
    void aScanIsRefused() {
        // An empty-but-valid PDF stands in for a scan: bytes, pages, no text layer. Accepting it would
        // put a document on the seller's screen that can never ground anything and never say why.
        assertThatThrownBy(() -> KnowledgeDocumentText.extract("scan.txt", "  \n \n ".getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("스캔");
    }

    @Test
    @DisplayName("a file over the byte bound is refused before anything parses it")
    void tooLargeIsRefused() {
        byte[] big = new byte[KnowledgeDocumentText.MAX_BYTES + 1];
        assertThatThrownBy(() -> KnowledgeDocumentText.extract("big.txt", big))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("10MB");
    }

    @Test
    @DisplayName("the document's title is the seller's own filename, without its extension")
    void titleIsTheFilename() {
        assertThat(KnowledgeDocumentService.titleFor("제품 사용설명서.pdf")).isEqualTo("제품 사용설명서");
        assertThat(KnowledgeDocumentService.titleFor("/tmp/배송교환정책.docx")).isEqualTo("배송교환정책");
        assertThat(KnowledgeDocumentService.titleFor(".pdf")).isEqualTo("올린 자료");
    }
}
