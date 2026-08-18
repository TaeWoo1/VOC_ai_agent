package com.sellerops.user;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "users")
public class User extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(nullable = false, unique = true)
    private String email;

    /** Null for a social-only user (Google/NAVER sign-up) — password login is then refused. */
    @Column(name = "password_hash")
    private String passwordHash;

    @Column(nullable = false)
    private String name;

    /** Free-form role string (e.g. OWNER, OPERATOR). */
    @Column(nullable = false)
    private String role;
}
