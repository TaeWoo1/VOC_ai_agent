package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * Feature-flag + secret gating for the ESM import. With {@code
 * sellerops.inquiry-import.esm.enabled} false (default) the controller and the
 * secret-dependent beans are not registered, so the backend starts with no preview-token
 * secret and the routes 404. With it true, a strong secret is required or the context
 * fails closed. Proven with {@link ApplicationContextRunner} (no web boot needed).
 */
class EsmInquiryImportRegistrationTest {

    private static final String FLAG = "sellerops.inquiry-import.esm.enabled";
    private static final String SECRET = "sellerops.inquiry-import.preview-token.secret";
    private static final String STRONG_SECRET = "a-32-byte-or-longer-random-secret-value-xyz";  // >=32 bytes

    // ---- controller registration ----------------------------------------------

    private final ApplicationContextRunner controllerRunner = new ApplicationContextRunner()
            .withBean(EsmInquiryImportService.class, () -> mock(EsmInquiryImportService.class))
            .withBean("unrelatedBean", String.class, () -> "ok")
            .withUserConfiguration(EsmInquiryImportController.class);

    @Test
    void controllerAndSecretBeansAbsentByDefaultAndUnrelatedStillStarts() {
        controllerRunner.run(ctx -> {
            assertThat(ctx).hasNotFailed();                                      // backend still starts
            assertThat(ctx).doesNotHaveBean(EsmInquiryImportController.class);   // endpoints absent
            assertThat(ctx.getBean("unrelatedBean")).isEqualTo("ok");           // unrelated functionality present
        });
    }

    @Test
    void controllerAbsentWhenFlagExplicitlyFalse() {
        controllerRunner.withPropertyValues(FLAG + "=false")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(EsmInquiryImportController.class));
    }

    @Test
    void controllerPresentWhenFlagTrue() {
        controllerRunner.withPropertyValues(FLAG + "=true")
                .run(ctx -> assertThat(ctx).hasSingleBean(EsmInquiryImportController.class));
    }

    // ---- file-import account controller (BOTH flags required) ------------------

    private static final String PROVISION_FLAG = "sellerops.inquiry-import.esm.account-provisioning.enabled";

    private final ApplicationContextRunner fileImportRunner = new ApplicationContextRunner()
            .withBean(EsmFileImportAccountService.class, () -> mock(EsmFileImportAccountService.class))
            .withBean(com.sellerops.user.UserRepository.class,
                    () -> mock(com.sellerops.user.UserRepository.class))
            .withUserConfiguration(EsmFileImportAccountController.class);

    @Test
    void fileImportControllerAbsentByDefault() {
        fileImportRunner.run(ctx -> assertThat(ctx).doesNotHaveBean(EsmFileImportAccountController.class));
    }

    @Test
    void fileImportControllerAbsentWhenOnlyImportEnabled() {
        // Provisioning must be its own explicit flag — import-enabled alone is not enough.
        fileImportRunner.withPropertyValues(FLAG + "=true", PROVISION_FLAG + "=false")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(EsmFileImportAccountController.class));
    }

    @Test
    void fileImportControllerAbsentWhenOnlyProvisioningEnabled() {
        fileImportRunner.withPropertyValues(PROVISION_FLAG + "=true")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(EsmFileImportAccountController.class));
    }

    @Test
    void fileImportControllerPresentOnlyWhenBothFlagsTrue() {
        fileImportRunner.withPropertyValues(FLAG + "=true", PROVISION_FLAG + "=true")
                .run(ctx -> assertThat(ctx).hasSingleBean(EsmFileImportAccountController.class));
    }

    @Test
    void previewControllerStaysAvailableWhenProvisioningDisabled() {
        // preview/confirm depend only on esm.enabled — provisioning being off doesn't remove them.
        controllerRunner.withPropertyValues(FLAG + "=true", PROVISION_FLAG + "=false")
                .run(ctx -> assertThat(ctx).hasSingleBean(EsmInquiryImportController.class));
    }

    // ---- secret-dependent bean (fail-closed) -----------------------------------

    private final ApplicationContextRunner tokenRunner = new ApplicationContextRunner()
            .withUserConfiguration(PreviewTokenService.class);

    @Test
    void tokenServiceAbsentWhenDisabledEvenWithNoSecret() {
        tokenRunner.run(ctx -> {
            assertThat(ctx).hasNotFailed();
            assertThat(ctx).doesNotHaveBean(PreviewTokenService.class);
        });
    }

    @Test
    void tokenServicePresentWhenEnabledWithStrongSecret() {
        tokenRunner.withPropertyValues(FLAG + "=true", SECRET + "=" + STRONG_SECRET)
                .run(ctx -> {
                    assertThat(ctx).hasNotFailed();
                    assertThat(ctx).hasSingleBean(PreviewTokenService.class);
                });
    }

    @Test
    void enabledWithMissingSecretFailsClosed() {
        tokenRunner.withPropertyValues(FLAG + "=true")
                .run(ctx -> assertThat(ctx).getFailure().isNotNull());
    }

    @Test
    void enabledWithWeakSecretFailsClosed() {
        tokenRunner.withPropertyValues(FLAG + "=true", SECRET + "=too-short")
                .run(ctx -> assertThat(ctx).getFailure().isNotNull());
    }
}
