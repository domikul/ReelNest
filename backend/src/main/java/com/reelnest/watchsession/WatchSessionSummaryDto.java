package com.reelnest.watchsession;

import java.time.Instant;
import java.util.UUID;

public record WatchSessionSummaryDto(
        UUID id,
        String name,
        Instant createdAt,
        Instant completedAt,
        int postCount,
        int currentPosition) {
}
