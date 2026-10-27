package com.reelnest;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.UUID;

public final class IntegrationAccountSupport {

    private IntegrationAccountSupport() {
    }

    public static UUID createAccount(
            JdbcTemplate jdbcTemplate,
            PasswordEncoder passwordEncoder,
            String username,
            String password) {
        UUID accountId = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO accounts (id, username, password_hash) VALUES (?, ?, ?)",
                accountId,
                username,
                passwordEncoder.encode(password));
        return accountId;
    }
}
