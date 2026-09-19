package com.sellerops.inquiry.authority;

import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.order.fact.OrderFactLookup;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/**
 * What THIS inquiry's resolution may use — built by code for each request ({@link CapabilityRegistry}), never by a model.
 *
 * <p>A plan names capability ids; this snapshot says which of them can act here and why not. A capability that cannot act
 * is not replaced by another authority — it becomes a {@link ResolutionState#CAPABILITY_GAP} with a reason. The snapshot is
 * an input like the customer's message: {@link #fingerprint()} joins a calibration capture's other fingerprints, so the same
 * message under a different registry is a different observation.
 *
 * @param variantCount the listing's option count — the structured fact a knowledge step needs to tell a product-level
 *                     sentence from an answer for the customer's size (docs/inquiry_decision_v2_2.md §7). Not the names:
 *                     the snapshot is about what can act, and it is fingerprinted.
 */
public record CapabilitySnapshot(String version, String channelCode, InquirySurface surface, boolean orderBound,
                                 OrderFactLookup lookup, DetailCapability detail, int variantCount,
                                 Map<CapabilityId, CapabilityStatus> capabilities,
                                 Map<EntityField, CapabilityStatus> fields) {

    public static final String VERSION = "capability-registry/v1";

    public CapabilitySnapshot {
        EnumMap<CapabilityId, CapabilityStatus> c = new EnumMap<>(CapabilityId.class);
        for (CapabilityId id : CapabilityId.values()) {
            CapabilityStatus s = capabilities == null ? null : capabilities.get(id);
            c.put(id, s == null ? CapabilityStatus.NOT_SUPPORTED : s);
        }
        EnumMap<EntityField, CapabilityStatus> f = new EnumMap<>(EntityField.class);
        for (EntityField id : EntityField.values()) {
            CapabilityStatus s = fields == null ? null : fields.get(id);
            f.put(id, s == null ? CapabilityStatus.NOT_SUPPORTED : s);
        }
        capabilities = java.util.Collections.unmodifiableMap(c);
        fields = java.util.Collections.unmodifiableMap(f);
    }

    public CapabilityStatus status(CapabilityId id) {
        return capabilities.get(id);
    }

    public CapabilityStatus status(EntityField field) {
        return fields.get(field);
    }

    /** Fields of one capability this snapshot cannot observe. */
    public List<EntityField> unsupported(CapabilityId capability) {
        List<EntityField> out = new ArrayList<>();
        for (EntityField f : EntityField.values()) {
            if (f.capability() == capability && fields.get(f) != CapabilityStatus.AVAILABLE) {
                out.add(f);
            }
        }
        return out;
    }

    /** Stable over field order: one line per fact, in enum order. */
    public String fingerprint() {
        StringBuilder sb = new StringBuilder(version).append('\n')
                .append("channel=").append(channelCode).append('\n')
                .append("surface=").append(surface).append('\n')
                .append("orderBound=").append(orderBound).append('\n')
                .append("lookup=").append(lookup).append('\n')
                .append("detail=").append(detail).append('\n')
                .append("variants=").append(variantCount).append('\n');
        capabilities.forEach((k, v) -> sb.append(k.wire()).append('=').append(v).append('\n'));
        fields.forEach((k, v) -> sb.append(k).append('=').append(v).append('\n'));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(sb.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
