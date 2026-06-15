package com.sellerops.collect;

import com.sellerops.collect.dto.CredentialTemplateView;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only credential-field shape per channel — what a connection-info form must
 * collect. Metadata only (never a value/secret/encryptionKeyId). Auth-gated like
 * every non-auth endpoint; reference data, so not org-scoped — mirrors
 * {@link ChannelCapabilityController}.
 */
@RestController
@RequestMapping("/api/channels/{code}/credential-template")
public class CredentialTemplateController {

    private final CredentialTemplateService service;

    public CredentialTemplateController(CredentialTemplateService service) {
        this.service = service;
    }

    @GetMapping
    public CredentialTemplateView credentialTemplate(@PathVariable String code) {
        return service.credentialTemplate(code);
    }
}
