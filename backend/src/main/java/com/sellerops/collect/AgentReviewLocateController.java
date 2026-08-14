package com.sellerops.collect;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.channel.ChannelReviewLocateService;
import com.sellerops.review.channel.dto.AgentReviewLocateTargetView;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Local Agent's locate route: it hands over a {@code locateRef} the seller's browser gave it, and gets
 * back the fields it has to match a live WING row on.
 *
 * <p><b>Why the agent asks and the browser does not tell.</b> The Action Window contract forbids carrying
 * anything that identifies a review, and the locate target — product, option, date, rating, body
 * fingerprint — is exactly that. Routing it through the seller's page would put a description of one
 * buyer's review into a browser tab and a websocket frame on the way to a component that only needed to say
 * "this one". So the browser carries an opaque token, and the agent spends it here under its own JWT.
 *
 * <p><b>A POST, because the ref is spent.</b> Resolving is not a repeatable read: the token is single-use
 * and this call is what uses it. A GET that quietly consumed its subject would be a lie about the verb.
 *
 * <p>The org comes from the JWT principal and never from the path, so a token belonging to another tenant
 * resolves to the same refusal as one that never existed.
 */
@RestController
@RequestMapping("/api/agent")
public class AgentReviewLocateController {

    private final ChannelReviewLocateService service;

    public AgentReviewLocateController(ChannelReviewLocateService service) {
        this.service = service;
    }

    @PostMapping("/review-locate-targets/{locateRef}")
    public AgentReviewLocateTargetView resolve(@AuthenticationPrincipal AuthPrincipal principal,
                                               @PathVariable String locateRef) {
        return service.resolve(principal.orgId(), locateRef);
    }
}
