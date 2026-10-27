package com.reelnest.security;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class AccountRegistrationService {

    private static final Pattern VALID_USERNAME = Pattern.compile("[\\p{L}\\p{N}][\\p{L}\\p{N}._-]{2,31}");
    private static final int MIN_PASSWORD_LENGTH = 12;
    private static final int MAX_BCRYPT_PASSWORD_BYTES = 72;

    private final JdbcTemplate jdbcTemplate;
    private final PasswordEncoder passwordEncoder;

    public AccountRegistrationService(JdbcTemplate jdbcTemplate, PasswordEncoder passwordEncoder) {
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
    }

    public AccountPrincipal register(String submittedUsername, String password) {
        String username = submittedUsername == null ? "" : submittedUsername.strip();
        if (!VALID_USERNAME.matcher(username).matches()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Username must be 3–32 letters or numbers and may contain periods, underscores, or hyphens.");
        }
        if (password == null
                || password.isBlank()
                || password.codePointCount(0, password.length()) < MIN_PASSWORD_LENGTH
                || password.getBytes(StandardCharsets.UTF_8).length > MAX_BCRYPT_PASSWORD_BYTES) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Password must be at least 12 characters and no more than 72 UTF-8 bytes.");
        }

        UUID accountId = UUID.randomUUID();
        String passwordHash = passwordEncoder.encode(password);
        try {
            jdbcTemplate.update(
                    "INSERT INTO accounts (id, username, password_hash) VALUES (?, ?, ?)",
                    accountId,
                    username,
                    passwordHash);
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That username is already taken.");
        }
        return new AccountPrincipal(accountId, username, passwordHash);
    }
}
