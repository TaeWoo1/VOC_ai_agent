package com.sellerops.product.detail.image;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.product.ProductVariant;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Read one product's 상세페이지 pictures, and publish only what survives the authority rules.
 *
 * <p><b>The order is load-bearing.</b> Variants first, then pictures — a picture's 규격 label can
 * only be associated against 규격 that are already stored, so reading images for a product with no
 * stored variants would spend 26 model calls to produce 26 UNRESOLVED triples. That is why
 * {@link #read} refuses outright when the catalogue has no options for this product, and why the
 * enrichment that writes them runs before the enrichment that reads pictures.
 *
 * <p><b>Finalization is after ALL pictures, never per picture.</b> Rule C — contradicting values for
 * the same 규격 — cannot be seen from inside one image, and an authority decided image by image
 * would publish whichever table it happened to read first.
 *
 * <p><b>The crash this class is designed around.</b> Model answers, receipt is written, process dies
 * before publication. With counts alone, the restart would skip the call (the receipt says done) and
 * the triples would be gone — bought and lost. So the closed triples are stored ON the receipt at the
 * moment the model answers, and everything after that point is re-runnable from the store without a
 * vendor call. {@link ProductDetailImageReceipt.Status#RUNNING} is the honest opposite case: a row
 * left there cannot tell us whether the vendor was reached, so it is re-read.
 */
@Service
public class ProductDetailImageKnowledge {

    private static final Logger log = LoggerFactory.getLogger(ProductDetailImageKnowledge.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** The title a seller sees. The same words the text lane uses — it is the same page. */
    static final String DOCUMENT_TITLE = "상품 상세페이지";

    private final ImageFactExtractionService extraction;
    private final DetailImageFetcher fetcher;
    private final ProductDetailImageReceiptRepository receipts;
    private final ProductVariantRepository variants;
    private final ProductKnowledgeSourceRepository sources;
    private final ProductKnowledgeIndexer indexer;

    @org.springframework.beans.factory.annotation.Autowired
    public ProductDetailImageKnowledge(ImageFactExtractionService extraction,
                                       ProductDetailImageReceiptRepository receipts,
                                       ProductVariantRepository variants,
                                       ProductKnowledgeSourceRepository sources,
                                       ProductKnowledgeIndexer indexer) {
        this(extraction, null, receipts, variants, sources, indexer);
    }

    ProductDetailImageKnowledge(ImageFactExtractionService extraction,
                                       DetailImageFetcher fetcher,
                                       ProductDetailImageReceiptRepository receipts,
                                       ProductVariantRepository variants,
                                       ProductKnowledgeSourceRepository sources,
                                       ProductKnowledgeIndexer indexer) {
        this.extraction = extraction;
        // Constructed rather than injected: the fetcher is the one credential-free egress in this
        // backend and there is exactly one caller that needs it with bytes. A container-wide bean
        // would make it available to everything, which is the opposite of what it is.
        this.fetcher = fetcher == null ? new DetailImageFetcher() : fetcher;
        this.receipts = receipts;
        this.variants = variants;
        this.sources = sources;
        this.indexer = indexer;
    }

    /** How a whole product's image reading ended. */
    public enum Outcome {
        /** The capability is off for this org, or no key is configured. */
        DISABLED,
        /** The page has no detail images to read. */
        NO_IMAGES,
        /**
         * The catalogue holds no 규격 for this product, so nothing a picture says could be associated.
         * A cost fence, not a failure: reading anyway would buy UNRESOLVED triples at full price.
         */
        NO_VARIANTS,
        /** Every picture was read (or reused) and finalization ran. */
        READ
    }

    /** What the run did, in numbers a manifest can be checked against. */
    public record Result(Outcome outcome, int imagesConsidered, int imagesFetched, int modelCalls,
                         int reusedReceipts, int imagesWithFacts, int zeroFactImages,
                         int failedImages, int accepted, int unresolved, int refused,
                         int publishedDocuments, ImageFactExtractionGenerator.Usage usage,
                         List<ImageFactAuthority.Judged> judged) {

        static Result of(Outcome outcome) {
            return new Result(outcome, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    ImageFactExtractionGenerator.Usage.NONE, List.of());
        }
    }

    /** Which extractor and model this lane is configured with, for a run to record before it runs. */
    public String extractorVersion() {
        return extraction.extractorVersion() + "|" + extraction.modelVersion();
    }

    /**
     * Is a reading of this product's pictures in flight right now?
     *
     * <p>This is what makes 「상품 상세 정보를 확인 중입니다」 a state with a PRODUCER rather than a
     * label nobody sets. Until the image lane existed there was no moment at which SellerOps was
     * mid-way through learning something about a product, so the draft path had only two honest
     * answers; now there is a third, and a seller who asks during that window must not be told their
     * knowledge library is missing something.
     */
    public boolean inFlight(UUID orgId, UUID productId) {
        if (orgId == null || productId == null) {
            return false;
        }
        return receipts.findAllByOrgIdAndProductId(orgId, productId).stream()
                .anyMatch(receipt -> receipt.getStatus() == ProductDetailImageReceipt.Status.PENDING
                        || receipt.getStatus() == ProductDetailImageReceipt.Status.RUNNING);
    }

    /**
     * Read this product's detail images and publish what may be stated.
     *
     * @param imageUrls  the {@code <img src>} of the 상세페이지, in document order — never the
     *                   listing gallery, which is a different set and is barred as a grounding source
     * @param channelRef the listing reference the documents are keyed under
     */
    public Result read(UUID orgId, UUID productId, String channelRef, List<String> imageUrls) {
        if (!extraction.isEnabledFor(orgId)) {
            return Result.of(Outcome.DISABLED);
        }
        if (imageUrls == null || imageUrls.isEmpty()) {
            return Result.of(Outcome.NO_IMAGES);
        }
        List<String> optionNames = optionNamesFor(orgId, productId);
        if (optionNames.isEmpty()) {
            log.info("image-knowledge org={} outcome=NO_VARIANTS images={}", orgId, imageUrls.size());
            return Result.of(Outcome.NO_VARIANTS);
        }

        String extractorVersion = extraction.extractorVersion();
        String modelVersion = extraction.modelVersion();
        int considered = Math.min(imageUrls.size(), ImageFetchPolicy.MAX_IMAGES_PER_PRODUCT);
        int fetched = 0;
        int modelCalls = 0;
        int reused = 0;
        int failed = 0;
        ImageFactExtractionGenerator.Usage usage = ImageFactExtractionGenerator.Usage.NONE;
        List<ImageFactAuthority.ImageFacts> perImage = new ArrayList<>();
        Map<String, ProductDetailImageReceipt> receiptBySha = new LinkedHashMap<>();

        for (int i = 0; i < considered; i++) {
            DetailImageFetcher.Loaded loaded = fetcher.loadOne(imageUrls.get(i), i);
            if (!loaded.ok()) {
                // No hash, so no receipt: identity here is the picture's bytes, and a fetch that
                // failed has none. Counted and reported instead of invented.
                failed++;
                continue;
            }
            fetched++;
            String sha = loaded.meta().sha256();
            Optional<ProductDetailImageReceipt> existing = receipts
                    .findByOrgIdAndProductIdAndImageSha256AndExtractorVersionAndModelVersion(
                            orgId, productId, sha, extractorVersion, modelVersion);
            if (existing.isPresent() && existing.get().reusable()) {
                reused++;
                receiptBySha.put(sha, existing.get());
                perImage.add(new ImageFactAuthority.ImageFacts(sha, storedFacts(existing.get())));
                continue;
            }

            ProductDetailImageReceipt receipt = existing.orElseGet(ProductDetailImageReceipt::new);
            Instant now = Instant.now();
            receipt.setOrgId(orgId);
            receipt.setProductId(productId);
            receipt.setImageSha256(sha);
            receipt.setExtractorVersion(extractorVersion);
            receipt.setModelVersion(modelVersion);
            if (receipt.getQueuedAt() == null) {
                receipt.setQueuedAt(now);
            }
            receipt.setStartedAt(now);
            receipt.setStatus(ProductDetailImageReceipt.Status.RUNNING);
            receipt = receipts.save(receipt);

            ImageFactExtractionGenerator.Result read =
                    extraction.read(orgId, loaded.bytes(), loaded.meta().contentType());
            modelCalls++;
            usage = usage.plus(read.usage());
            receipt.setCompletedAt(Instant.now());
            if (read.ok()) {
                ExtractedImageFacts facts = read.facts().orElse(ExtractedImageFacts.empty());
                receipt.setStatus(ProductDetailImageReceipt.Status.COMPLETED);
                receipt.setOutcome(facts.isEmpty() ? ProductDetailImageReceipt.Outcome.NO_FACTS
                        : ProductDetailImageReceipt.Outcome.FACTS_EXTRACTED);
                receipt.setExtraction(toJson(facts));
                perImage.add(new ImageFactAuthority.ImageFacts(sha, facts));
            } else {
                receipt.setStatus(ProductDetailImageReceipt.Status.FAILED);
                receipt.setOutcome("off_schema".equals(read.reason())
                        ? ProductDetailImageReceipt.Outcome.OFF_SCHEMA
                        : ProductDetailImageReceipt.Outcome.MODEL_FAILED);
                failed++;
            }
            receiptBySha.put(sha, receipts.save(receipt));
        }

        ImageFactAuthority.Finalized finalized = ImageFactAuthority.decide(perImage, optionNames);
        int published = publish(orgId, productId, channelRef, finalized, receiptBySha);
        writeBackCounts(finalized, receiptBySha);

        int withFacts = (int) perImage.stream().filter(image -> !image.facts().isEmpty()).count();
        Result result = new Result(Outcome.READ, considered, fetched, modelCalls, reused, withFacts,
                perImage.size() - withFacts, failed,
                finalized.accepted().size(),
                (int) finalized.countOf(ImageFactAuthority.Verdict.UNRESOLVED_NO_EXACT_VARIANT),
                (int) (finalized.countOf(ImageFactAuthority.Verdict.REFUSED_NO_SPEC_LABEL)
                        + finalized.countOf(ImageFactAuthority.Verdict.REFUSED_CONFLICTING_VALUE)),
                published, usage, finalized.judged());
        log.info("image-knowledge org={} outcome=READ considered={} fetched={} model_calls={} "
                        + "reused={} accepted={} unresolved={} refused={} published={}",
                orgId, considered, fetched, modelCalls, reused, result.accepted(),
                result.unresolved(), result.refused(), published);
        return result;
    }

    /**
     * One document per PICTURE that has accepted facts. Never one blob for the product.
     *
     * <p>A single merged document would be cheaper and would destroy the only thing that lets a
     * person check a claim: which picture on the seller's own page it was read from. Pictures with no
     * accepted fact produce no document at all — a zero-result reading is recorded on its receipt,
     * where it belongs, and never as an empty knowledge document that would inflate 「등록된 지식」.
     */
    private int publish(UUID orgId, UUID productId, String channelRef,
                        ImageFactAuthority.Finalized finalized,
                        Map<String, ProductDetailImageReceipt> receiptBySha) {
        Map<String, List<ImageFactAuthority.Judged>> perImage = new LinkedHashMap<>();
        for (ImageFactAuthority.Judged judged : finalized.accepted()) {
            perImage.computeIfAbsent(judged.imageSha256(), k -> new ArrayList<>()).add(judged);
        }
        int published = 0;
        for (Map.Entry<String, List<ImageFactAuthority.Judged>> entry : perImage.entrySet()) {
            String ref = channelRef + "#img:" + entry.getKey();
            ProductKnowledgeSource source = sources
                    .findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, productId).stream()
                    .filter(s -> ref.equals(s.getChannelSourceRef()))
                    .findFirst()
                    .orElseGet(ProductKnowledgeSource::new);
            source.setOrgId(orgId);
            source.setProductId(productId);
            source.setSourceType(KnowledgeSourceType.DESCRIPTION);
            // The provenance the whole lane turns on. It is NOT SELLER_ENTERED_KNOWLEDGE and it is
            // NOT SELLER_AUTHORED_CHANNEL_CONTENT: a person wrote the picture, a model read it, and
            // carriesExactFiguresUnaided() already makes the drafter treat that differently.
            source.setAuthoredOrigin(KnowledgeAuthorship.AI_EXTRACTED_FROM_SELLER_IMAGE);
            source.setChannelSourceRef(ref);
            source.setTitle(DOCUMENT_TITLE);
            source.setBody(body(entry.getValue()));
            // authorName stays null: nobody at this company typed this.
            indexer.index(sources.save(source));
            published++;
        }
        return published;
    }

    /**
     * The published text: one accepted triple per line, in the seller's own printed words.
     *
     * <p>The matched 규격 is written rather than the label the picture used, because that is the name
     * the customer will choose from and the two are the same 규격 by exact match — that is what
     * "accepted" means here.
     */
    private static String body(List<ImageFactAuthority.Judged> accepted) {
        StringBuilder out = new StringBuilder();
        for (ImageFactAuthority.Judged judged : accepted) {
            out.append(judged.matchedOptionName()).append(" · ")
                    .append(judged.fact().attribute()).append(": ")
                    .append(judged.fact().value()).append('\n');
        }
        return out.toString().strip();
    }

    private void writeBackCounts(ImageFactAuthority.Finalized finalized,
                                 Map<String, ProductDetailImageReceipt> receiptBySha) {
        Map<String, int[]> counts = new LinkedHashMap<>();
        for (ImageFactAuthority.Judged judged : finalized.judged()) {
            int[] pair = counts.computeIfAbsent(judged.imageSha256(), k -> new int[2]);
            if (judged.accepted()) {
                pair[0]++;
            } else {
                pair[1]++;
            }
        }
        counts.forEach((sha, pair) -> {
            ProductDetailImageReceipt receipt = receiptBySha.get(sha);
            if (receipt != null) {
                receipt.setFactsAccepted(pair[0]);
                receipt.setFactsRefused(pair[1]);
                receipts.save(receipt);
            }
        });
    }

    private List<String> optionNamesFor(UUID orgId, UUID productId) {
        return variants.findByOrgIdAndProductId(orgId, productId).stream()
                .map(ProductVariant::getOptionName)
                .filter(name -> name != null && !name.isBlank())
                .toList();
    }

    private static ExtractedImageFacts storedFacts(ProductDetailImageReceipt receipt) {
        return ImageFactResponseParser.parse(receipt.getExtraction())
                .orElse(ExtractedImageFacts.empty());
    }

    private static String toJson(ExtractedImageFacts facts) {
        try {
            return MAPPER.writeValueAsString(facts);
        } catch (Exception e) {
            // Unreachable for a record of strings, and a receipt without its triples is still a
            // receipt: the next run re-reads the picture rather than publishing nothing forever.
            return null;
        }
    }
}
