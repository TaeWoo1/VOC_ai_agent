package com.sellerops.inquirysignal;

import com.sellerops.reviewissue.InquiryAskKind;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Classify an inquiry's text once, and never again.
 *
 * <p><b>The cache is the contract.</b> Every path into semantic classification comes through here, so
 * "a customer sentence reaches a vendor at most once" is a property of one method rather than a habit
 * spread across callers. A cache hit — including a MISS that was cached — returns without any egress.
 *
 * <p><b>A failure is a null signature, never a guess.</b> Capability off, model declined,
 * off-vocabulary answer, transport error: all of them store and return "not classified". The
 * alternative — a default topic — would let every unclassifiable inquiry pool into one bucket that a
 * seller is then shown as their biggest repeated question. That is not hypothetical; it is what
 * {@code 기타} did on real data before it was excluded.
 */
@Service
public class InquirySignatureService {

    private static final Logger log = LoggerFactory.getLogger(InquirySignatureService.class);

    private final InquirySignatureClassifier classifier;
    private final InquirySignatureCacheRepository cache;

    public InquirySignatureService(InquirySignatureClassifier classifier,
                                   InquirySignatureCacheRepository cache) {
        this.classifier = classifier;
        this.cache = cache;
    }

    public boolean isEnabledFor(UUID orgId) {
        return classifier.isEnabledFor(orgId);
    }

    public String extractorKind() {
        return classifier.kind();
    }

    public String extractorVersion() {
        return classifier.version();
    }

    /**
     * The signature for one inquiry text, from cache or from the model.
     *
     * <p><b>{@code REQUIRES_NEW} on purpose.</b> The cache write must survive the caller's transaction
     * rolling back: if an indexing pass fails after a classification, the model has already been asked
     * and the answer must not be thrown away — otherwise the retry re-sends the same customer sentence.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Optional<InquirySignature> signatureFor(UUID orgId, String text) {
        // Markup out before anything else. On real data 3,201 of 3,220 bodies are HTML, so classifying
        // the raw column classifies style attributes — measured at 5 usable labels out of 190 texts.
        // Normalizing here rather than at each call site means the CACHE KEY is the normalized text too,
        // so two renderings of one question cost one egress instead of two.
        String normalized = InquiryText.normalize(text);
        if (normalized.isBlank()) {
            return Optional.empty();
        }
        String hash = hashOf(normalized);
        Optional<InquirySignatureCacheEntry> cached = cache.findByOrgIdAndContentHash(orgId, hash);
        if (cached.isPresent()) {
            return toSignature(cached.get());
        }
        if (!classifier.isEnabledFor(orgId)) {
            // Nothing is cached for a capability that is off: turning it on later must actually ask,
            // rather than inherit a page of misses recorded while it was disabled.
            return Optional.empty();
        }

        Optional<InquirySignatureClassifier.Classification> answer = classifier.classify(orgId, normalized);
        InquirySignatureCacheEntry entry = new InquirySignatureCacheEntry();
        entry.setOrgId(orgId);
        entry.setContentHash(hash);
        entry.setExtractorKind(classifier.kind());
        entry.setExtractorVersion(classifier.version());
        answer.ifPresent(c -> {
            entry.setSignatureKey(c.signature().signatureKey());
            entry.setTopic(c.signature().topic());
            entry.setAskKind(c.signature().ask().name());
            entry.setSeverity(c.signature().severity().name());
            entry.setProviderVersion(c.providerVersion());
        });
        cache.save(entry);
        log.info("inquiry-signature org={} classified={} kind={}", orgId, answer.isPresent(), classifier.kind());
        return answer.map(InquirySignatureClassifier.Classification::signature);
    }

    private static Optional<InquirySignature> toSignature(InquirySignatureCacheEntry entry) {
        if (entry.getSignatureKey() == null || entry.getTopic() == null || entry.getAskKind() == null) {
            return Optional.empty(); // A cached MISS. Asking again would re-expose the same text.
        }
        try {
            return Optional.of(new InquirySignature(entry.getTopic(),
                    InquiryAskKind.valueOf(entry.getAskKind())));
        } catch (IllegalArgumentException stale) {
            // A row written by an older vocabulary. Treated as a miss rather than repaired: a value the
            // current vocabulary cannot name must not be re-labelled into one that it can.
            return Optional.empty();
        }
    }

    /**
     * The cache key: sha-256 over the markup-free, lower-cased text.
     *
     * <p>One row per distinct QUESTION rather than per distinct stored string, so a mall that re-renders
     * its board HTML does not re-expose the same sentence. One-way: the text is not recoverable, and
     * nothing downstream needs it to be.
     */
    static String hashOf(String normalizedText) {
        String normalized = InquiryText.forHashing(normalizedText);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(normalized.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", e);
        }
    }
}
