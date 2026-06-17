package com.sellerops.collect;

import com.sellerops.collect.dto.CredentialTemplateView;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialTemplates;
import org.springframework.stereotype.Service;

/**
 * Serves the backend-owned credential-field shape for a channel. Reference data
 * only — reads the static {@link CredentialTemplates} map, never the vault, a
 * repo, or any stored secret. Channels without a defined shape (file-upload /
 * not-yet-integrated) resolve to 404.
 */
@Service
public class CredentialTemplateService {

    public CredentialTemplateView credentialTemplate(String channelCode) {
        return CredentialTemplates.find(channelCode)
                .map(CredentialTemplateView::from)
                .orElseThrow(() -> ApiException.notFound("연결 정보 양식을 찾을 수 없습니다."));
    }
}
