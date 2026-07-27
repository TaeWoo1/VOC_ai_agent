package com.sellerops.selleraccount;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * The server-owned, opaque, STABLE per-account slot the local-agent runtime learns instead of a
 * seller-account id — plus the account's durable session readiness.
 *
 * <p><b>Why a slot.</b> The runtime keeps each seller's marketplace login in a persistent browser profile
 * so it survives an agent restart, and two accounts on one channel must not share cookies. The agent picks
 * the profile directory from a per-account key — but the Action Window wire refuses to carry a
 * seller-account id (see {@code ReviewImportLaunch}). So the server mints one opaque {@link #accountSlot}
 * per account and hands only that to the runtime; the agent hashes it into a fixed profile directory. The
 * slot is not reversible to the account, so nothing on the wire, in a log, or on the agent's filesystem
 * path is an identity.
 *
 * <p><b>Stability.</b> Unlike {@code ReviewImportLaunch#launchRef} (one per run), the slot is minted once
 * per account and reused forever — which is exactly what makes "same account -> same profile after a
 * restart" true.
 *
 * <p><b>Durable readiness.</b> {@link #readinessState} persists session liveness (login / 2FA / expiry)
 * that previously lived only in the agent's memory and was lost on restart. It is reconciled with — never
 * conflated with — the sync-run health {@code ChannelConnectionStatus} owns.
 *
 * <p>See {@code V30__account_session_slot.sql}.
 */
@Getter
@Setter
@Entity
@Table(name = "account_session_slot")
public class AccountSessionSlot extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false, unique = true)
    private UUID sellerAccountId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    /** The opaque, stable per-account key carried to the runtime. Never reversible to the account. */
    @Column(name = "account_slot", nullable = false, length = 24)
    private String accountSlot;

    @Enumerated(EnumType.STRING)
    @Column(name = "readiness_state", nullable = false, length = 32)
    private SessionReadinessState readinessState = SessionReadinessState.UNOBSERVED_EXTERNAL;

    /** The probe moment that last wrote {@link #readinessState}; null until the session is first observed. */
    @Enumerated(EnumType.STRING)
    @Column(name = "readiness_reason", length = 24)
    private SessionProbeReason readinessReason;

    @Column(name = "last_observed_at")
    private Instant lastObservedAt;
}
