package com.reelnest.importer;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ImportSummary(
        UUID importId,
        String status,
        int addedCount,
        int updatedCount,
        int skippedCount,
        int errorCount,
        List<ImportItemError> errors,
        Instant createdAt) {
}
