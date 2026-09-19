package com.sellerops.inquiry.authority;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code sellerops.inquiry-authority.fence.enabled} — default OFF. Its own prefix: the fence is not part of the Inquiry
 * Decision LLM capability, and no file may read two capabilities' flags ({@code AgentDraftBoundaryTest}). When on, and only where Inquiry Decision v2 is
 * already on for the org, the v2 verdicts are held to their authority ({@link AuthorityFence}). It calls no model and no
 * channel: the snapshot is built from stored rows and the order fact is the one the assessor already read.
 */
@Component
public class AuthorityFenceProperties {

    private final boolean enabled;

    public AuthorityFenceProperties(@Value("${sellerops.inquiry-authority.fence.enabled:false}") boolean enabled) {
        this.enabled = enabled;
    }

    public boolean enabled() {
        return enabled;
    }
}
