package com.reelnest.library;

import java.time.Instant;
import java.util.UUID;

public record PostDto(
        UUID id,
        String originalUrl,
        Instant savedAt) {
}
