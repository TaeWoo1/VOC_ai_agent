package com.sellerops.knowledge.semantic;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** One cached vector: this organisation's embedding of this exact text, under this exact model. */
@Entity
@Table(name = "knowledge_embedding")
public class KnowledgeEmbedding {

    @Id
    private UUID id = UUID.randomUUID();

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "content_sha256", nullable = false, length = 64)
    private String contentSha256;

    @Column(nullable = false, length = 80)
    private String model;

    @Column(nullable = false)
    private int dimensions;

    /**
     * Four bytes per dimension. The length only shapes a Hibernate-generated schema (the offline test database):
     * production runs Flyway's {@code bytea} with {@code ddl-auto: none}, and the default 255 cannot hold one
     * 1024-dimension vector.
     */
    @Column(name = "vector", nullable = false, length = 16384)
    private byte[] vector;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public UUID getId() {
        return id;
    }

    public UUID getOrgId() {
        return orgId;
    }

    public void setOrgId(UUID orgId) {
        this.orgId = orgId;
    }

    public String getContentSha256() {
        return contentSha256;
    }

    public void setContentSha256(String contentSha256) {
        this.contentSha256 = contentSha256;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public int getDimensions() {
        return dimensions;
    }

    public void setDimensions(int dimensions) {
        this.dimensions = dimensions;
    }

    public byte[] getVector() {
        return vector;
    }

    public void setVector(byte[] vector) {
        this.vector = vector;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
