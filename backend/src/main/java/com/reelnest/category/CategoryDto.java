package com.reelnest.category;

import java.time.Instant;
import java.util.UUID;

public record CategoryDto(
        UUID id,
        String name,
        Instant createdAt,
        Instant updatedAt) {
}
