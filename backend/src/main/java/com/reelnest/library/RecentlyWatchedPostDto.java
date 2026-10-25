package com.reelnest.library;

import java.time.Instant;
import java.util.UUID;

public record RecentlyWatchedPostDto(
        UUID id,
        String originalUrl,
        Instant savedAt,
        boolean favorite,
        Instant lastViewedAt) {
}
