package com.sellerops.connector.cafe24;

import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * Runs the offline thread repair once, at boot, and only when an operator has said so.
 *
 * <p><b>Five gates.</b> The connector flag, this runner's own flag, a configured account, a manifest
 * file that exists, and an expected manifest hash that matches its bytes — then, last, {@code dry-run},
 * which defaults to {@code true}. The hash gate is the one that matters: it binds this run to the
 * exact observation a live READ produced, so a manifest edited afterwards cannot be applied by
 * accident.
 *
 * <p><b>It makes no marketplace request of any kind.</b> There is no client, no authorizer and no
 * token on this path. It is not wired into the scheduler, the collection path, or any HTTP surface.
 * Every number it logs is a count.
 */
public class Cafe24ThreadRepairRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ThreadRepairRunner.class);
    private static final String TAG = "[cafe24-thread-repair]";

    private final Cafe24ThreadRepair repair;
    private final SellerAccountRepository accounts;
    private final String accountId;
    private final int boardNo;
    private final String manifestPath;
    private final String expectedHash;
    private final boolean dryRun;

    public Cafe24ThreadRepairRunner(Cafe24ThreadRepair repair, SellerAccountRepository accounts,
                                    String accountId, int boardNo, String manifestPath,
                                    String expectedHash, boolean dryRun) {
        this.repair = repair;
        this.accounts = accounts;
        this.accountId = accountId;
        this.boardNo = boardNo;
        this.manifestPath = manifestPath;
        this.expectedHash = expectedHash;
        this.dryRun = dryRun;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (accountId == null || accountId.isBlank() || manifestPath == null || manifestPath.isBlank()) {
            log.info("{} account-id 또는 manifest 미설정 — 아무것도 변경하지 않음.", TAG);
            return;
        }
        if (expectedHash == null || expectedHash.isBlank()) {
            log.warn("{} expected-hash 미설정 — 관측에 묶이지 않은 매니페스트는 적용하지 않음.", TAG);
            return;
        }
        Path path = Path.of(manifestPath.strip());
        if (!Files.isRegularFile(path)) {
            log.warn("{} 매니페스트 파일을 찾지 못함 — 아무것도 변경하지 않음.", TAG);
            return;
        }
        SellerAccount account = accounts.findById(UUID.fromString(accountId.strip())).orElse(null);
        if (account == null) {
            log.warn("{} 계정을 찾지 못함 — 아무것도 변경하지 않음.", TAG);
            return;
        }
        List<Cafe24ThreadRepair.Observation> manifest;
        String actualHash;
        try {
            actualHash = Cafe24ThreadRepair.hash(path);
            if (!actualHash.equalsIgnoreCase(expectedHash.strip())) {
                log.warn("{} 매니페스트 해시 불일치 — 아무것도 변경하지 않음.", TAG);
                return;
            }
            manifest = Cafe24ThreadRepair.readManifest(path);
        } catch (Exception e) {
            log.warn("{} 매니페스트를 읽을 수 없음 — 아무것도 변경하지 않음.", TAG);
            return;
        }
        // The command id is the manifest itself, so a replay of the same observation appends no
        // duplicate audit row and a different observation can never reuse the key.
        String commandId = "thread-repair:" + actualHash.substring(0, 16);
        log.info("{} start board={} 매니페스트={}건 dry_run={}", TAG, boardNo, manifest.size(), dryRun);
        Cafe24ThreadRepair.Result result = repair.repair(account.getOrgId(), account.getId(), boardNo,
                manifest, commandId, dryRun);
        log.info("{} 매니페스트={} 조회됨={} 드리프트={} 중단={} 역할기록={} 현재읽기제외={} 업무종결={} 감사={} 기적용={} dry_run={}",
                TAG, result.manifestRows(), result.resolved(), result.drifted(), result.aborted(),
                result.rolesWritten(), result.statesExcluded(), result.itemsDismissed(),
                result.auditsWritten(), result.alreadyRepaired(), result.dryRun());
    }
}
