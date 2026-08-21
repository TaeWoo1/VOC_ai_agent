package com.sellerops.inquirysignal;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.customermemory.CustomerMemoryEntryRepository;
import com.sellerops.customermemory.CustomerMemoryKind;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sanitized visibility into the inquiry-signature capability: is it on, and how far has it got.
 *
 * <p><b>Counts only.</b> There is no route here that returns an inquiry, a signature for a named
 * inquiry, or any text. The reason is the one this whole capability is fenced by: the customer's words
 * are readable on the authorized inquiry detail screen and nowhere else, and a "show me what the model
 * said about this one" endpoint would be a second place they could be reconstructed from.
 *
 * <p>The numbers exist because "the pipeline runs" is not the completion criterion —
 * {@code contracts/inquiry-issue/v1/RUBRIC.md} is — and a yield of zero on a real corpus must be
 * visible rather than inferred from an empty screen.
 */
@RestController
@RequestMapping("/api/inquiry-signature")
public class InquirySignatureController {

    private final InquirySignatureService signatures;
    private final InquirySignatureCacheRepository cache;
    private final CustomerMemoryEntryRepository entries;

    public InquirySignatureController(InquirySignatureService signatures,
                                      InquirySignatureCacheRepository cache,
                                      CustomerMemoryEntryRepository entries) {
        this.signatures = signatures;
        this.cache = cache;
        this.entries = entries;
    }

    @GetMapping("/stats")
    public StatsView stats(@AuthenticationPrincipal AuthPrincipal principal) {
        UUID orgId = principal.orgId();
        long classified = cache.countByOrgIdAndSignatureKeyIsNotNull(orgId);
        long attempted = cache.countByOrgId(orgId);
        return new StatsView(
                signatures.isEnabledFor(orgId),
                signatures.extractorKind(),
                signatures.extractorVersion(),
                entries.countByOrgIdAndEntryKind(orgId, CustomerMemoryKind.INQUIRY),
                entries.countSignedInquiries(orgId),
                attempted,
                classified);
    }

    /**
     * @param indexedInquiries inquiries in the customer-memory index at all
     * @param signedInquiries of those, how many carry a signature — the number that was 0 of 3,220 on
     *     real data before this capability, and the one the rubric's recall gate is measured against
     * @param textsAttempted distinct inquiry texts sent to the model at all (a text is sent once, ever)
     * @param textsClassified of those, how many came back with two usable labels
     */
    public record StatsView(boolean enabled, String extractorKind, String extractorVersion,
                            long indexedInquiries, long signedInquiries,
                            long textsAttempted, long textsClassified) {
    }
}
