package com.reelnest.watchsession;

import com.reelnest.security.AccountPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
public class WatchSessionController {

    private static final int MAX_NAME_LENGTH = 80;

    private final WatchSessionService watchSessionService;

    public WatchSessionController(WatchSessionService watchSessionService) {
        this.watchSessionService = watchSessionService;
    }

    @GetMapping("/api/watch-sessions")
    public List<WatchSessionSummaryDto> listSessions(@AuthenticationPrincipal AccountPrincipal account) {
        return watchSessionService.findSessions(account.accountId());
    }

    @GetMapping("/api/watch-sessions/{sessionId}")
    public ResponseEntity<WatchSessionDto> getSession(
            @AuthenticationPrincipal AccountPrincipal account,
            @PathVariable UUID sessionId) {
        return watchSessionService.findSession(account.accountId(), sessionId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/api/watch-sessions")
    public ResponseEntity<WatchSessionDto> createSession(
            @AuthenticationPrincipal AccountPrincipal account,
            @RequestBody CreateWatchSessionRequest request) {
        if (request == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Watch session details are required.");
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(
                watchSessionService.createSession(account.accountId(), validateName(request.name()), request.postIds()));
    }

    @PutMapping("/api/watch-sessions/{sessionId}/progress")
    public ResponseEntity<WatchSessionDto> updateProgress(
            @AuthenticationPrincipal AccountPrincipal account,
            @PathVariable UUID sessionId,
            @RequestBody UpdateProgressRequest request) {
        if (request == null || request.currentPosition() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Session position is required.");
        }
        return watchSessionService.updateProgress(account.accountId(), sessionId, request.currentPosition())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    private String validateName(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        String normalized = name.strip();
        if (normalized.length() > MAX_NAME_LENGTH) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Watch session name must be no longer than " + MAX_NAME_LENGTH + " characters.");
        }
        if (normalized.chars().anyMatch(Character::isISOControl)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Watch session name cannot contain control characters.");
        }
        return normalized;
    }

    public record CreateWatchSessionRequest(String name, List<UUID> postIds) {
    }

    public record UpdateProgressRequest(Integer currentPosition) {
    }
}
