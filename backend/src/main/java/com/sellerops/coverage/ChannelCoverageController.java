package com.sellerops.coverage;

import com.sellerops.channel.ProductChannels;
import com.sellerops.coverage.dto.ChannelCoverageRow;
import com.sellerops.auth.AuthPrincipal;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * READ: what each seller-visible channel can currently say, per data type.
 *
 * <p>Org-scoped from the JWT, never from a parameter — the coverage of one org's channels is a
 * statement about that org's connections and rows. The channel set is
 * {@link ProductChannels#VISIBLE_CODES}: a channel on screen is a channel that is actually usable,
 * and a coverage answer about a channel the product does not show would be a promise it does not make.
 */
@RestController
@RequestMapping("/api/channels/coverage")
public class ChannelCoverageController {

    private final ChannelCoverageService service;

    public ChannelCoverageController(ChannelCoverageService service) {
        this.service = service;
    }

    @GetMapping
    public List<ChannelCoverageRow> coverage(@AuthenticationPrincipal AuthPrincipal principal) {
        return service.coverage(principal.orgId(), ProductChannels.VISIBLE_CODES);
    }
}
