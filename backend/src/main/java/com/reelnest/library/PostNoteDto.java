package com.reelnest.library;

import java.time.Instant;
import java.util.UUID;

public record PostNoteDto(
        UUID postId,
        String note,
        Instant updatedAt) {
}
