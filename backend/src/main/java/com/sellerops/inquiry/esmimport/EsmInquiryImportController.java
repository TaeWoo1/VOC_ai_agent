package com.sellerops.inquiry.esmimport;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.esmimport.dto.EsmInquiryConfirmResponse;
import com.sellerops.inquiry.esmimport.dto.EsmInquiryPreviewResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Manual ESM (G마켓/옥션) inquiry Excel-import: an interim intake bridge that feeds the
 * existing canonical inquiry workflow. Two steps, both multipart, both authenticated:
 * {@code preview} classifies and returns a signed token (zero writes); {@code confirm}
 * requires the same file re-uploaded plus that token and an explicit confirmation, then
 * persists. Org and uploader come from the authenticated principal — never the request.
 */
@RestController
@RequestMapping("/api/inquiry-imports/esm")
@ConditionalOnProperty(name = "sellerops.inquiry-import.esm.enabled", havingValue = "true")
public class EsmInquiryImportController {

    private final EsmInquiryImportService service;

    public EsmInquiryImportController(EsmInquiryImportService service) {
        this.service = service;
    }

    @PostMapping(path = "/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public EsmInquiryPreviewResponse preview(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam UUID channelId,
            @RequestParam UUID sellerAccountId,
            @RequestParam EsmMarketplace marketplace,
            @RequestParam("file") MultipartFile file) {
        require(principal);
        return service.preview(principal.orgId(), channelId, sellerAccountId, marketplace,
                file.getOriginalFilename(), bytes(file), Instant.now());
    }

    @PostMapping(path = "/confirm", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public EsmInquiryConfirmResponse confirm(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam String previewToken,
            @RequestParam String confirmation,
            @RequestParam("file") MultipartFile file) {
        require(principal);
        return service.confirm(principal.orgId(), principal.userId(), previewToken, confirmation,
                file.getOriginalFilename(), bytes(file), Instant.now());
    }

    private static void require(AuthPrincipal principal) {
        if (principal == null) {
            throw ApiException.unauthorized("인증이 필요합니다.");
        }
    }

    private static byte[] bytes(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("파일이 비어 있습니다.");
        }
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw ApiException.badRequest("파일을 읽지 못했습니다: " + e.getMessage());
        }
    }
}
