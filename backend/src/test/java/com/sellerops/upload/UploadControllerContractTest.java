package com.sellerops.upload;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.auth.JwtAuthFilter;
import com.sellerops.auth.JwtTokenProvider;
import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.config.SecurityConfig;
import com.sellerops.connector.FileUploadConnector;
import com.sellerops.ingest.IngestResult;
import com.sellerops.ingest.UploadType;
import com.sellerops.organization.OrganizationRepository;
import java.io.InputStream;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Pins the {@code POST /api/uploads} HTTP contract — the wire the collector posts
 * to ({@code collector/src/upload.ts}). Both sides were previously tested only
 * inward: the collector against a fake {@code fetch}, the backend by calling
 * {@link FileUploadConnector#ingest} directly. Nothing asserted the multipart
 * field names, the principal→orgId propagation, or the unauthenticated behaviour,
 * so a rename on either side would have broken silently.
 *
 * <p>This is the project's first MockMvc test (the convention to date is
 * {@code @DataJpaTest} + hand-{@code new}ed services). It uses {@code @WebMvcTest}
 * with the REAL {@link SecurityConfig} so the 401 path is genuinely exercised rather
 * than simulated — importing that {@code @Configuration} is what makes Boot's default
 * filter chain back off. {@link JwtAuthFilter} needs no import: it is a
 * {@code jakarta.servlet.Filter}, which {@code @WebMvcTest} component-scans by
 * default. Only {@link JwtTokenProvider} (token cryptography — not this contract's
 * concern) and {@link FileUploadConnector} (the ingest chain, covered by
 * {@code ExportToReportChainTest}) are mocked. Hermetic: no datasource, no network,
 * no credentials — the bearer token is a fixed literal whose parse result is stubbed.
 *
 * <p>Every rejection here is a mapped, sanitized 4xx — an unbound part, an unknown
 * upload type, an empty file, and both unauthenticated paths. None of them reach
 * ingest, and none of the error envelopes echo request content.
 */
@WebMvcTest(UploadController.class)
@Import(SecurityConfig.class)
@ActiveProfiles("test")
class UploadControllerContractTest {

    @Autowired MockMvc mockMvc;
    @MockBean FileUploadConnector connector;
    @MockBean JwtTokenProvider tokenProvider;
    /**
     * The token's organization has to exist for the request to be authenticated at all: `JwtAuthFilter` checks,
     * because an org-scoped read against a vanished org succeeds and returns nothing (see that filter).
     */
    @MockBean OrganizationRepository organizations;

    private static final String TOKEN = "test-only-token-never-a-real-jwt";
    private final UUID orgId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private final UUID syncJobId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        // The filter is real; only the token→principal step is stubbed.
        when(tokenProvider.parse(TOKEN)).thenReturn(new AuthPrincipal(userId, orgId, "test@example.com"));
        when(organizations.existsById(orgId)).thenReturn(true);
    }

    @Test
    void multipartFieldNamesBindAndTheResultIsMappedToJson() throws Exception {
        when(connector.ingest(any(), any(), any(), anyString(), any(), any()))
                .thenReturn(new IngestResult(syncJobId, UploadType.REVIEW, "SUCCESS", 3, 2, 1, 0, null, List.of()));

        mockMvc.perform(multipart("/api/uploads")
                        .file(xlsxPart("file"))
                        .param("channelId", channelId.toString())
                        .param("uploadType", "REVIEW")
                        .param("method", "SELLER_CENTER_EXPORT")
                        .header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.syncJobId").value(syncJobId.toString()))
                .andExpect(jsonPath("$.uploadType").value("REVIEW"))
                .andExpect(jsonPath("$.status").value("SUCCESS"))
                .andExpect(jsonPath("$.totalRows").value(3))
                .andExpect(jsonPath("$.successRows").value(2))
                .andExpect(jsonPath("$.skippedRows").value(1))
                .andExpect(jsonPath("$.failedRows").value(0))
                .andExpect(jsonPath("$.sampleErrors").isEmpty());
    }

    @Test
    void orgIdComesFromTheAuthenticatedPrincipalAndEveryFieldReachesTheConnectorUnchanged() throws Exception {
        when(connector.ingest(any(), any(), any(), anyString(), any(), any()))
                .thenReturn(new IngestResult(syncJobId, UploadType.REVIEW, "SUCCESS", 1, 1, 0, 0, null, List.of()));

        // A hostile org id in the BODY must be ignored — tenancy comes from the JWT only.
        mockMvc.perform(multipart("/api/uploads")
                        .file(xlsxPart("file"))
                        .param("channelId", channelId.toString())
                        .param("uploadType", "REVIEW")
                        .param("method", "SELLER_CENTER_EXPORT")
                        .param("orgId", UUID.randomUUID().toString())
                        .header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isOk());

        ArgumentCaptor<UUID> org = ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<UUID> channel = ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<String> filename = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<CollectionMethod> method = ArgumentCaptor.forClass(CollectionMethod.class);
        verify(connector).ingest(org.capture(), channel.capture(), eq(UploadType.REVIEW),
                filename.capture(), any(InputStream.class), method.capture());

        assertThat(org.getValue()).isEqualTo(orgId);   // principal.orgId(), never the request param
        assertThat(channel.getValue()).isEqualTo(channelId);
        assertThat(filename.getValue()).isEqualTo("review_synthetic.xlsx");
        assertThat(method.getValue()).isEqualTo(CollectionMethod.SELLER_CENTER_EXPORT);
    }

    @Test
    void methodIsOptionalAndReachesTheConnectorAsNullWhenOmitted() throws Exception {
        when(connector.ingest(any(), any(), any(), anyString(), any(), any()))
                .thenReturn(new IngestResult(syncJobId, UploadType.REVIEW, "SUCCESS", 1, 1, 0, 0, null, List.of()));

        // The collector may omit `method`; the controller forwards null and the
        // connector resolves the MANUAL_UPLOAD default (FileUploadConnector:83).
        mockMvc.perform(multipart("/api/uploads")
                        .file(xlsxPart("file"))
                        .param("channelId", channelId.toString())
                        .param("uploadType", "REVIEW")
                        .header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isOk());

        verify(connector).ingest(eq(orgId), eq(channelId), eq(UploadType.REVIEW),
                anyString(), any(InputStream.class), eq(null));
    }

    @Test
    void unauthenticatedUploadIsRejectedWith401AndNeverReachesTheConnector() throws Exception {
        mockMvc.perform(multipart("/api/uploads")
                        .file(xlsxPart("file"))
                        .param("channelId", channelId.toString())
                        .param("uploadType", "REVIEW"))
                .andExpect(status().isUnauthorized())
                // Attributes the 401 to THIS project's entry point (SecurityConfig:48-50, a bare
                // sendError(401)). Boot's default chain would also 401 here, but via
                // BasicAuthenticationEntryPoint — which sets WWW-Authenticate. Without this
                // matcher the status alone cannot tell the two apart.
                .andExpect(header().doesNotExist("WWW-Authenticate"));

        verifyNoInteractions(connector);
    }

    @Test
    void aBearerTokenThatDoesNotParseIsAlsoRejectedWith401() throws Exception {
        // JwtTokenProvider.parse returns null (never throws) on any malformed token —
        // JwtTokenProvider:53-55 is a blanket catch. Mockito's default for an unstubbed
        // call is already null, so this exercises the real contract: the filter takes the
        // Bearer branch (JwtAuthFilter:33-35) but leaves the context unauthenticated.
        mockMvc.perform(multipart("/api/uploads")
                        .file(xlsxPart("file"))
                        .param("channelId", channelId.toString())
                        .param("uploadType", "REVIEW")
                        .header("Authorization", "Bearer garbage"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist("WWW-Authenticate"));

        verifyNoInteractions(connector);
    }

    @Test
    void anEmptyFileIsRejectedWith400BeforeAnyIngest() throws Exception {
        mockMvc.perform(multipart("/api/uploads")
                        .file(new MockMultipartFile("file", "empty.xlsx",
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new byte[0]))
                        .param("channelId", channelId.toString())
                        .param("uploadType", "REVIEW")
                        .header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("파일이 비어 있습니다."));

        verify(connector, never()).ingest(any(), any(), any(), anyString(), any(), any());
    }

    @Test
    void missingFilePartIsRejectedWith400AndNeverReachesTheConnector() throws Exception {
        // Pins the part name: anything other than "file" fails to bind, and
        // GlobalExceptionHandler maps the miss to a sanitized 400 (a client error)
        // rather than letting the catch-all report it as a 500 server fault.
        // The envelope echoes the part NAME only — never the part's content.
        mockMvc.perform(multipart("/api/uploads")
                        .file(xlsxPart("upload"))   // wrong part name
                        .param("channelId", channelId.toString())
                        .param("uploadType", "REVIEW")
                        .header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.message").value("필수 파일 항목이 없습니다: file"));

        verifyNoInteractions(connector);
    }

    @Test
    void anUnknownUploadTypeIsRejectedWith400AndNeverReachesTheConnector() throws Exception {
        mockMvc.perform(multipart("/api/uploads")
                        .file(xlsxPart("file"))
                        .param("channelId", channelId.toString())
                        .param("uploadType", "NOT_A_REAL_TYPE")
                        .header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(connector);
    }

    /** A synthetic xlsx part — bytes are a PK stub only; the connector is mocked, nothing parses them. */
    private MockMultipartFile xlsxPart(String partName) {
        return new MockMultipartFile(partName, "review_synthetic.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                new byte[] {0x50, 0x4B, 0x03, 0x04});
    }
}
