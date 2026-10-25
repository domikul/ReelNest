package com.reelnest.importer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Instant;
import java.time.DateTimeException;
import java.util.ArrayList;
import java.util.List;

@Component
public class InstagramSavedPostsParser {

    private final ObjectMapper objectMapper;

    public InstagramSavedPostsParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public ParsedImport parse(byte[] content) {
        JsonNode root;
        try {
            root = objectMapper.readTree(content);
        } catch (IOException exception) {
            throw new ImportValidationException(HttpStatus.BAD_REQUEST, "Upload must contain valid JSON.");
        }

        if (root == null || !root.isArray() || root.isEmpty()) {
            throw unsupportedFormat();
        }

        ArrayNode records = (ArrayNode) root;
        if (!hasSavedPostShape(records)) {
            throw unsupportedFormat();
        }

        List<ParsedPost> posts = new ArrayList<>();
        List<ImportItemError> errors = new ArrayList<>();
        for (int index = 0; index < records.size(); index++) {
            JsonNode record = records.get(index);
            try {
                posts.add(parseRecord(record, index + 1));
            } catch (InvalidRecordException exception) {
                errors.add(new ImportItemError(index + 1, exception.code, exception.getMessage()));
            }
        }
        return new ParsedImport(List.copyOf(posts), List.copyOf(errors));
    }

    private ParsedPost parseRecord(JsonNode record, int recordIndex) {
        if (!record.isObject()) {
            throw invalid("invalid_record", "Record must be a JSON object.");
        }

        JsonNode identifier = record.get("fbid");
        if (identifier == null || !identifier.isTextual() || identifier.asText().isBlank()) {
            throw invalid("invalid_identifier", "Record must contain a non-empty string fbid.");
        }

        JsonNode timestamp = record.get("timestamp");
        if (timestamp == null || !timestamp.isIntegralNumber() || !timestamp.canConvertToLong()) {
            throw invalid("invalid_timestamp", "Record must contain an integer timestamp.");
        }

        Instant savedAt;
        try {
            long epochSeconds = timestamp.longValue();
            if (epochSeconds < 0) {
                throw invalid("invalid_timestamp", "Record timestamp must not be negative.");
            }
            savedAt = Instant.ofEpochSecond(epochSeconds);
        } catch (DateTimeException exception) {
            throw invalid("invalid_timestamp", "Record timestamp is outside the supported range.");
        }

        JsonNode labelValues = record.get("label_values");
        if (labelValues == null || !labelValues.isArray()) {
            throw invalid("invalid_metadata", "Record must contain a label_values array.");
        }

        List<JsonNode> hrefValues = new ArrayList<>();
        for (JsonNode labelValue : labelValues) {
            if (labelValue.isObject() && labelValue.has("href")) {
                hrefValues.add(labelValue.get("href"));
            }
        }
        if (hrefValues.isEmpty()) {
            throw invalid("missing_post_url", "Record does not contain a post URL in label_values.");
        }
        if (hrefValues.size() > 1) {
            throw invalid("ambiguous_post_url", "Record contains multiple post URLs in label_values.");
        }

        JsonNode href = hrefValues.get(0);
        if (href == null || !href.isTextual()) {
            throw invalid("invalid_post_url", "Post URL must be a string.");
        }

        InstagramUrlNormalizer.NormalizedUrl normalizedUrl;
        try {
            normalizedUrl = InstagramUrlNormalizer.normalize(href.asText());
        } catch (IllegalArgumentException exception) {
            throw invalid("invalid_post_url", exception.getMessage());
        }

        return new ParsedPost(
                identifier.asText().trim(),
                normalizedUrl.original(),
                normalizedUrl.canonical(),
                savedAt,
                labelValues.deepCopy(),
                recordIndex);
    }

    private boolean hasSavedPostShape(ArrayNode records) {
        for (JsonNode record : records) {
            JsonNode labelValues = record.get("label_values");
            if (labelValues == null || !labelValues.isArray()) {
                continue;
            }
            for (JsonNode labelValue : labelValues) {
                if (labelValue.isObject() && labelValue.has("href")) {
                    return true;
                }
            }
        }
        return false;
    }

    private ImportValidationException unsupportedFormat() {
        return new ImportValidationException(
                HttpStatus.UNPROCESSABLE_ENTITY,
                "Unsupported export structure. This endpoint accepts the observed saved_posts.json format.");
    }

    private InvalidRecordException invalid(String code, String message) {
        return new InvalidRecordException(code, message);
    }

    public record ParsedPost(
            String sourceIdentifier,
            String originalUrl,
            String canonicalUrl,
            Instant savedAt,
            JsonNode sourceMetadata,
            int recordIndex) {
    }

    public record ParsedImport(List<ParsedPost> posts, List<ImportItemError> errors) {
    }

    private static final class InvalidRecordException extends RuntimeException {

        private final String code;

        private InvalidRecordException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
