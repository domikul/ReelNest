package com.reelnest.security;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class AccountUserDetailsService implements UserDetailsService {

    private final JdbcTemplate jdbcTemplate;

    public AccountUserDetailsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public UserDetails loadUserByUsername(String username) {
        List<AccountPrincipal> accounts = jdbcTemplate.query(
                "SELECT id, username, password_hash FROM accounts WHERE LOWER(username) = LOWER(?)",
                (resultSet, rowNumber) -> new AccountPrincipal(
                        resultSet.getObject("id", java.util.UUID.class),
                        resultSet.getString("username"),
                        resultSet.getString("password_hash")),
                username.strip());
        return accounts.stream()
                .findFirst()
                .orElseThrow(() -> new UsernameNotFoundException("Account was not found."));
    }
}
