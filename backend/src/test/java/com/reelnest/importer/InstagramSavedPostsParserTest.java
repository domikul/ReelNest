package com.reelnest.importer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InstagramSavedPostsParserTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final InstagramSavedPostsParser parser = new InstagramSavedPostsParser(objectMapper);

    @Test
    void parsesObservedSavedPostShapeAndRetainsNestedMetadata() throws Exception {
        String json = """
                [{
                  "fbid": "synthetic-id-1",
                  "timestamp": 1700000000,
                  "label_values": [
                    {"href": "https://www.instagram.com/reel/synthetic/"},
                    {"label": "synthetic-label", "value": "synthetic-value"}
                  ],
                  "media": []
                }]
                """;

        InstagramSavedPostsParser.ParsedImport result =
                parser.parse(json.getBytes(StandardCharsets.UTF_8));

        assertTrue(result.errors().isEmpty());
        assertEquals(1, result.posts().size());
        InstagramSavedPostsParser.ParsedPost post = result.posts().get(0);
        assertEquals("synthetic-id-1", post.sourceIdentifier());
        assertEquals("https://www.instagram.com/reel/synthetic", post.canonicalUrl());
        assertEquals(1700000000L, post.savedAt().getEpochSecond());
        JsonNode metadata = post.sourceMetadata();
        assertEquals(2, metadata.size());
        assertEquals("synthetic-value", metadata.get(1).get("value").asText());
    }

    @Test
    void reportsMalformedRecordsWithoutDiscardingValidRecords() {
        String json = """
                [
                  {
                    "fbid": "synthetic-id-1",
                    "timestamp": 1700000000,
                    "label_values": [{"href": "https://www.instagram.com/p/synthetic/"}],
                    "media": []
                  },
                  {
                    "fbid": 42,
                    "timestamp": 1700000000,
                    "label_values": [{"href": "https://www.instagram.com/p/synthetic-2/"}],
                    "media": []
                  }
                ]
                """;

        InstagramSavedPostsParser.ParsedImport result =
                parser.parse(json.getBytes(StandardCharsets.UTF_8));

        assertEquals(1, result.posts().size());
        assertEquals(1, result.errors().size());
        assertEquals(2, result.errors().get(0).recordIndex());
        assertEquals("invalid_identifier", result.errors().get(0).code());
    }

    @Test
    void rejectsMalformedJsonWithoutEchoingItsContents() {
        ImportValidationException exception = assertThrows(
                ImportValidationException.class,
                () -> parser.parse("{not-json}".getBytes(StandardCharsets.UTF_8)));

        assertEquals(HttpStatus.BAD_REQUEST, exception.getStatus());
        assertEquals("Upload must contain valid JSON.", exception.getMessage());
    }

    @Test
    void rejectsObservedCollectionStructureAsUnsupportedByThePostImporter() {
        String json = """
                [{
                  "fbid": "synthetic-collection-id",
                  "timestamp": 1700000000,
                  "label_values": [
                    {"dict": [{"dict": [{"href": "https://www.instagram.com/p/synthetic/"}]}]}
                  ],
                  "media": []
                }]
                """;

        ImportValidationException exception = assertThrows(
                ImportValidationException.class,
                () -> parser.parse(json.getBytes(StandardCharsets.UTF_8)));

        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, exception.getStatus());
        assertTrue(exception.getMessage().contains("saved_posts.json"));
    }

    @Test
    void normalizesHostAndTrailingSlashButPreservesQueryParameters() {
        InstagramUrlNormalizer.NormalizedUrl first = InstagramUrlNormalizer.normalize(
                "HTTPS://WWW.Instagram.com/reel/example/?source=one#fragment");
        InstagramUrlNormalizer.NormalizedUrl second = InstagramUrlNormalizer.normalize(
                "https://www.instagram.com/reel/example?source=two");

        assertEquals(
                "https://www.instagram.com/reel/example?source=one",
                first.canonical());
        assertTrue(!first.canonical().equals(second.canonical()));
    }
}
