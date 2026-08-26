package com.sellerops.product.detail.image;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.product.ProductVariant;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * The orchestration, and above all the failure it is shaped around: <b>a crash between paying for a
 * reading and publishing it.</b>
 */
class ProductDetailImageKnowledgeTest {

    private final UUID org = UUID.randomUUID();
    private final UUID productId = UUID.randomUUID();

    private ImageFactExtractionService extraction;
    private DetailImageFetcher fetcher;
    private ProductDetailImageReceiptRepository receipts;
    private ProductVariantRepository variants;
    private ProductKnowledgeSourceRepository sources;
    private ProductKnowledgeIndexer indexer;
    private ProductDetailImageKnowledge lane;

    private final List<ProductDetailImageReceipt> saved = new ArrayList<>();

    @BeforeEach
    void setUp() {
        extraction = mock(ImageFactExtractionService.class);
        fetcher = mock(DetailImageFetcher.class);
        receipts = mock(ProductDetailImageReceiptRepository.class);
        variants = mock(ProductVariantRepository.class);
        sources = mock(ProductKnowledgeSourceRepository.class);
        indexer = mock(ProductKnowledgeIndexer.class);

        when(extraction.isEnabledFor(org)).thenReturn(true);
        when(extraction.extractorVersion()).thenReturn("image-fact/v1");
        when(extraction.modelVersion()).thenReturn("openai:gpt-5.6-terra");
        when(variants.findByOrgIdAndProductId(org, productId)).thenReturn(List.of(variant("1호"), variant("2호")));
        when(sources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(any(), any())).thenReturn(List.of());
        when(sources.save(any(ProductKnowledgeSource.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(receipts.save(any(ProductDetailImageReceipt.class))).thenAnswer(invocation -> {
            ProductDetailImageReceipt receipt = invocation.getArgument(0);
            saved.add(receipt);
            return receipt;
        });
        when(receipts.findByOrgIdAndProductIdAndImageSha256AndExtractorVersionAndModelVersion(
                any(), any(), anyString(), anyString(), anyString())).thenReturn(Optional.empty());
        when(receipts.findAllByOrgIdAndProductId(any(), any())).thenReturn(List.of());

        lane = new ProductDetailImageKnowledge(extraction, fetcher, receipts, variants, sources, indexer);
    }

    private static ProductVariant variant(String optionName) {
        ProductVariant variant = new ProductVariant();
        variant.setOptionName(optionName);
        return variant;
    }

    private void picture(int ordinal, String sha) {
        FetchedImage meta = new FetchedImage(ordinal, FetchedImage.Outcome.OK, sha, 1000,
                "image/jpeg", 860, 559);
        when(fetcher.loadOne("https://cdn.test/" + ordinal + ".jpg", ordinal))
                .thenReturn(new DetailImageFetcher.Loaded(meta, new byte[] {1, 2, 3}));
    }

    private static ImageFactExtractionGenerator.Result answering(String label, String value) {
        return new ImageFactExtractionGenerator.Result(
                Optional.of(new ExtractedImageFacts(List.of(
                        new ExtractedImageFacts.Fact(label, "수용 가닥수", value)))),
                "ok", new ImageFactExtractionGenerator.Usage(600, 90));
    }

    @Test
    @DisplayName("one picture, one call — and only an exactly-matched 규격 becomes a document")
    void readsAndPublishes() {
        picture(0, "sha-a");
        when(extraction.read(eq(org), any(), any())).thenReturn(answering("1호", "2가닥"));

        ProductDetailImageKnowledge.Result result =
                lane.read(org, productId, "NAVER|13250364547", List.of("https://cdn.test/0.jpg"));

        assertThat(result.outcome()).isEqualTo(ProductDetailImageKnowledge.Outcome.READ);
        assertThat(result.modelCalls()).isEqualTo(1);
        assertThat(result.accepted()).isEqualTo(1);
        assertThat(result.publishedDocuments()).isEqualTo(1);

        ArgumentCaptor<ProductKnowledgeSource> published =
                ArgumentCaptor.forClass(ProductKnowledgeSource.class);
        verify(sources).save(published.capture());
        assertThat(published.getValue().getAuthoredOrigin())
                .isEqualTo(KnowledgeAuthorship.AI_EXTRACTED_FROM_SELLER_IMAGE);
        assertThat(published.getValue().getTitle()).isEqualTo("상품 상세페이지");
        assertThat(published.getValue().getChannelSourceRef())
                .as("per-image provenance, never one blob for the product")
                .isEqualTo("NAVER|13250364547#img:sha-a");
        assertThat(published.getValue().getBody()).isEqualTo("1호 · 수용 가닥수: 2가닥");
        verify(indexer).index(any(ProductKnowledgeSource.class));
    }

    @Test
    @DisplayName("a completed receipt is reused — the same picture is never paid for twice")
    void completedReceiptSkipsTheModel() {
        picture(0, "sha-a");
        ProductDetailImageReceipt existing = new ProductDetailImageReceipt();
        existing.setStatus(ProductDetailImageReceipt.Status.COMPLETED);
        existing.setExtraction("{\"facts\":[{\"specLabel\":\"1호\",\"attribute\":\"수용 가닥수\","
                + "\"value\":\"2가닥\"}]}");
        when(receipts.findByOrgIdAndProductIdAndImageSha256AndExtractorVersionAndModelVersion(
                eq(org), eq(productId), eq("sha-a"), anyString(), anyString()))
                .thenReturn(Optional.of(existing));

        ProductDetailImageKnowledge.Result result =
                lane.read(org, productId, "NAVER|13250364547", List.of("https://cdn.test/0.jpg"));

        // THE CRASH CASE. The model answered, the receipt was written, the process died before
        // publication. Counts alone would have skipped the call AND lost the triples — bought and
        // lost. The triples are on the receipt, so the restart republishes without paying again.
        verify(extraction, never()).read(any(), any(), any());
        assertThat(result.modelCalls()).isZero();
        assertThat(result.reusedReceipts()).isEqualTo(1);
        assertThat(result.accepted()).isEqualTo(1);
        assertThat(result.publishedDocuments()).isEqualTo(1);
    }

    @Test
    @DisplayName("a RUNNING receipt is re-read — a crash mid-call cannot prove the vendor answered")
    void runningReceiptIsRetried() {
        picture(0, "sha-a");
        ProductDetailImageReceipt stuck = new ProductDetailImageReceipt();
        stuck.setStatus(ProductDetailImageReceipt.Status.RUNNING);
        when(receipts.findByOrgIdAndProductIdAndImageSha256AndExtractorVersionAndModelVersion(
                eq(org), eq(productId), eq("sha-a"), anyString(), anyString()))
                .thenReturn(Optional.of(stuck));
        when(extraction.read(eq(org), any(), any())).thenReturn(answering("1호", "2가닥"));

        ProductDetailImageKnowledge.Result result =
                lane.read(org, productId, "NAVER|13250364547", List.of("https://cdn.test/0.jpg"));

        // Re-reading one picture costs a fraction of a cent. Wrongly skipping it loses a fact the
        // seller's own page states, forever, with a receipt saying it was handled.
        assertThat(result.modelCalls()).isEqualTo(1);
    }

    @Test
    @DisplayName("a zero-fact picture is recorded, and produces no knowledge document")
    void zeroResultIsRecordedNotPublished() {
        picture(0, "sha-a");
        when(extraction.read(eq(org), any(), any())).thenReturn(
                new ImageFactExtractionGenerator.Result(Optional.of(ExtractedImageFacts.empty()),
                        "ok", ImageFactExtractionGenerator.Usage.NONE));

        ProductDetailImageKnowledge.Result result =
                lane.read(org, productId, "NAVER|13250364547", List.of("https://cdn.test/0.jpg"));

        assertThat(result.zeroFactImages()).isEqualTo(1);
        assertThat(result.publishedDocuments()).isZero();
        verify(sources, never()).save(any(ProductKnowledgeSource.class));
        assertThat(saved).anySatisfy(receipt -> assertThat(receipt.getOutcome())
                .isEqualTo(ProductDetailImageReceipt.Outcome.NO_FACTS));
    }

    @Test
    @DisplayName("no stored 규격 means no call at all — variants come before pictures")
    void noVariantsSpendsNothing() {
        when(variants.findByOrgIdAndProductId(org, productId)).thenReturn(List.of());

        ProductDetailImageKnowledge.Result result =
                lane.read(org, productId, "NAVER|13250364547", List.of("https://cdn.test/0.jpg"));

        assertThat(result.outcome()).isEqualTo(ProductDetailImageKnowledge.Outcome.NO_VARIANTS);
        verify(extraction, never()).read(any(), any(), any());
        verify(fetcher, never()).loadOne(anyString(), anyInt());
    }

    @Test
    @DisplayName("the capability off means nothing is fetched, let alone sent")
    void disabledDoesNothing() {
        when(extraction.isEnabledFor(org)).thenReturn(false);

        assertThat(lane.read(org, productId, "ref", List.of("https://cdn.test/0.jpg")).outcome())
                .isEqualTo(ProductDetailImageKnowledge.Outcome.DISABLED);
        verify(fetcher, never()).loadOne(anyString(), anyInt());
    }

    @Test
    @DisplayName("contradicting pictures publish nothing, even though both were read")
    void contradictionPublishesNothing() {
        picture(0, "sha-a");
        picture(1, "sha-b");
        when(extraction.read(eq(org), any(), any()))
                .thenReturn(answering("1호", "2가닥"), answering("1호", "4가닥"));

        ProductDetailImageKnowledge.Result result = lane.read(org, productId, "ref",
                List.of("https://cdn.test/0.jpg", "https://cdn.test/1.jpg"));

        assertThat(result.modelCalls()).isEqualTo(2);
        assertThat(result.accepted()).isZero();
        assertThat(result.refused()).isEqualTo(2);
        assertThat(result.publishedDocuments()).isZero();
    }

    @Test
    @DisplayName("a picture that could not be fetched is counted, and gets no receipt")
    void unfetchableImageIsCountedNotInvented() {
        when(fetcher.loadOne("https://cdn.test/0.jpg", 0)).thenReturn(
                new DetailImageFetcher.Loaded(
                        FetchedImage.failed(0, FetchedImage.Outcome.REFUSED_PRIVATE_ADDRESS), null));

        ProductDetailImageKnowledge.Result result =
                lane.read(org, productId, "ref", List.of("https://cdn.test/0.jpg"));

        // Identity here is the picture's bytes. A fetch that failed has none, so there is nothing to
        // key a receipt on — and inventing one would claim a reading that never happened.
        assertThat(result.failedImages()).isEqualTo(1);
        assertThat(result.modelCalls()).isZero();
        verify(receipts, never()).save(any(ProductDetailImageReceipt.class));
    }

    @Test
    @DisplayName("in-flight readings are visible, so the screen can say 「확인 중입니다」")
    void inFlightIsObservable() {
        ProductDetailImageReceipt running = new ProductDetailImageReceipt();
        running.setStatus(ProductDetailImageReceipt.Status.RUNNING);
        when(receipts.findAllByOrgIdAndProductId(org, productId)).thenReturn(List.of(running));

        assertThat(lane.inFlight(org, productId)).isTrue();
    }
}
