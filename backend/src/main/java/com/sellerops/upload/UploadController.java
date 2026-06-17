package com.sellerops.upload;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.connector.FileUploadConnector;
import com.sellerops.ingest.IngestResult;
import com.sellerops.ingest.UploadType;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/uploads")
public class UploadController {

    private final FileUploadConnector connector;

    public UploadController(FileUploadConnector connector) {
        this.connector = connector;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public IngestResult upload(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam UUID channelId,
            @RequestParam UploadType uploadType,
            @RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("파일이 비어 있습니다.");
        }
        try {
            return connector.ingest(principal.orgId(), channelId, uploadType,
                    file.getOriginalFilename(), file.getInputStream());
        } catch (IOException e) {
            throw ApiException.badRequest("파일을 읽지 못했습니다: " + e.getMessage());
        }
    }
}
