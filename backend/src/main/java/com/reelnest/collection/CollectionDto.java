package com.reelnest.collection;

import java.time.Instant;
import java.util.UUID;

public record CollectionDto(
        UUID id,
        String name,
        Instant createdAt,
        Instant updatedAt,
        long postCount) {
}
