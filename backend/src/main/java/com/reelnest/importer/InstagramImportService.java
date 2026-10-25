package com.reelnest.importer;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class InstagramImportService {

    private static final RowMapper<ExistingPost> EXISTING_POST_MAPPER = (resultSet, rowNumber) ->
            new ExistingPost(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("source_identifier"),
                    resultSet.getString("original_url"),
                    resultSet.getString("canonical_url"),
                    resultSet.getTimestamp("saved_at").toInstant(),
                    resultSet.getString("source_metadata"));

    private final JdbcTemplate jdbcTemplate;
    private final InstagramSavedPostsParser parser;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public InstagramImportService(
            JdbcTemplate jdbcTemplate,
            InstagramSavedPostsParser parser,
            ObjectMapper objectMapper,
            PlatformTransactionManager transactionManager) {
        this.jdbcTemplate = jdbcTemplate;
        this.parser = parser;
        this.objectMapper = objectMapper;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    public ImportSummary importSavedPosts(byte[] content) {
        InstagramSavedPostsParser.ParsedImport parsedImport = parser.parse(content);
        UUID importId = UUID.randomUUID();
        Instant createdAt = Instant.now();
        List<ImportItemError> errors = new ArrayList<>(parsedImport.errors());
        int added = 0;
        int updated = 0;
        int skipped = 0;

        jdbcTemplate.update(
                "INSERT INTO import_jobs (id, status, added_count, updated_count, skipped_count, error_count, errors) "
                        + "VALUES (?, 'IN_PROGRESS', 0, 0, 0, 0, '[]'::jsonb)",
                importId);

        for (InstagramSavedPostsParser.ParsedPost post : parsedImport.posts()) {
            try {
                UpsertResult result = transactionTemplate.execute(status -> upsert(post));
                if (result == null) {
                    throw new IllegalStateException("Post import transaction returned no result.");
                }
                switch (result) {
                    case ADDED -> added++;
                    case UPDATED -> updated++;
                    case SKIPPED -> skipped++;
                }
            } catch (PostConflictException exception) {
                errors.add(new ImportItemError(post.recordIndex(), "identifier_conflict", exception.getMessage()));
            } catch (DataAccessException exception) {
                errors.add(new ImportItemError(
                        post.recordIndex(),
                        "persistence_error",
                        "Record could not be persisted."));
            }
        }

        String status = errors.isEmpty() ? "COMPLETED" : "COMPLETED_WITH_ERRORS";
        String serializedErrors = serializeErrors(errors);
        jdbcTemplate.update(
                "UPDATE import_jobs SET status = ?, added_count = ?, updated_count = ?, skipped_count = ?, "
                        + "error_count = ?, errors = CAST(? AS jsonb) WHERE id = ?",
                status,
                added,
                updated,
                skipped,
                errors.size(),
                serializedErrors,
                importId);

        return new ImportSummary(importId, status, added, updated, skipped, errors.size(), List.copyOf(errors), createdAt);
    }

    public Optional<ImportSummary> findImport(UUID importId) {
        List<ImportSummary> results = jdbcTemplate.query(
                "SELECT id, status, added_count, updated_count, skipped_count, error_count, errors::text, created_at "
                        + "FROM import_jobs WHERE id = ?",
                (resultSet, rowNumber) -> new ImportSummary(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("status"),
                        resultSet.getInt("added_count"),
                        resultSet.getInt("updated_count"),
                        resultSet.getInt("skipped_count"),
                        resultSet.getInt("error_count"),
                        deserializeErrors(resultSet.getString("errors")),
                        resultSet.getTimestamp("created_at").toInstant()),
                importId);
        return results.stream().findFirst();
    }

    private UpsertResult upsert(InstagramSavedPostsParser.ParsedPost post) {
        List<ExistingPost> matches = jdbcTemplate.query(
                "SELECT id, source_identifier, original_url, canonical_url, saved_at, source_metadata::text "
                        + "FROM posts WHERE source_identifier = ? OR canonical_url = ? FOR UPDATE",
                EXISTING_POST_MAPPER,
                post.sourceIdentifier(),
                post.canonicalUrl());

        if (matches.size() > 1) {
            throw new PostConflictException("Source identifier and URL refer to different existing posts.");
        }

        String metadata = serialize(post.sourceMetadata());
        if (matches.isEmpty()) {
            jdbcTemplate.update(
                    "INSERT INTO posts (id, source_identifier, original_url, canonical_url, saved_at, source_metadata) "
                            + "VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb))",
                    UUID.randomUUID(),
                    post.sourceIdentifier(),
                    post.originalUrl(),
                    post.canonicalUrl(),
                    Timestamp.from(post.savedAt()),
                    metadata);
            return UpsertResult.ADDED;
        }

        ExistingPost existing = matches.get(0);
        if (existing.sourceIdentifier().equals(post.sourceIdentifier())
                && existing.originalUrl().equals(post.originalUrl())
                && existing.canonicalUrl().equals(post.canonicalUrl())
                && existing.savedAt().equals(post.savedAt())
                && readTree(existing.sourceMetadata()).equals(post.sourceMetadata())) {
            return UpsertResult.SKIPPED;
        }

        jdbcTemplate.update(
                "UPDATE posts SET source_identifier = ?, original_url = ?, canonical_url = ?, saved_at = ?, "
                        + "source_metadata = CAST(? AS jsonb), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                post.sourceIdentifier(),
                post.originalUrl(),
                post.canonicalUrl(),
                Timestamp.from(post.savedAt()),
                metadata,
                existing.id());
        return UpsertResult.UPDATED;
    }

    private String serialize(JsonNode value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Parsed source metadata could not be serialized.", exception);
        }
    }

    private String serializeErrors(List<ImportItemError> errors) {
        try {
            return objectMapper.writeValueAsString(errors);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Import errors could not be serialized.", exception);
        }
    }

    private JsonNode readTree(String value) {
        try {
            return objectMapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored source metadata is invalid JSON.", exception);
        }
    }

    private List<ImportItemError> deserializeErrors(String value) {
        try {
            return objectMapper.readerForListOf(ImportItemError.class).readValue(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored import errors are invalid JSON.", exception);
        }
    }

    private enum UpsertResult {
        ADDED,
        UPDATED,
        SKIPPED
    }

    private record ExistingPost(
            UUID id,
            String sourceIdentifier,
            String originalUrl,
            String canonicalUrl,
            Instant savedAt,
            String sourceMetadata) {
    }

    private static final class PostConflictException extends RuntimeException {

        private PostConflictException(String message) {
            super(message);
        }
    }
}
