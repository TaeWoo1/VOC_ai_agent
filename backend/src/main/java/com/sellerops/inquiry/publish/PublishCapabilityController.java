package com.sellerops.inquiry.publish;

import com.sellerops.inquiry.publish.dto.PublishCapabilityView;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only publish-capability status. A separate base path ({@code /api/inquiry-publish})
 * so it never collides with {@code /api/inquiries/{workItemId}}.
 *
 * <p>Exists so an orchestration client (the agent runtime) can verify — fail closed —
 * that the external reply-send path is disabled before it drives an approval. It reflects
 * the execution flag and the registered reply adapters; when execution is disabled (the
 * default) it reports {@code executionEnabled=false} and no adapters, which is the
 * guarantee that a confirm-publish dispatches nothing. No secret is exposed.
 */
@RestController
@RequestMapping("/api/inquiry-publish")
public class PublishCapabilityController {

    private final ChannelReplyAdapterRegistry adapters;
    private final boolean executionEnabled;

    public PublishCapabilityController(
            ChannelReplyAdapterRegistry adapters,
            @Value("${sellerops.inquiry.publish.execution-enabled:false}") boolean executionEnabled) {
        this.adapters = adapters;
        this.executionEnabled = executionEnabled;
    }

    @GetMapping("/capability")
    public PublishCapabilityView capability() {
        List<String> codes = new ArrayList<>(adapters.registeredChannelCodes());
        codes.sort(String::compareTo);
        return new PublishCapabilityView(executionEnabled, codes);
    }
}
