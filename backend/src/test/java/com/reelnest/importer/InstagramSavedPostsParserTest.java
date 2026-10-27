package com.reelnest.importer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InstagramSavedPostsParserTest {

    private final InstagramSavedPostsParser parser =
            new InstagramSavedPostsParser(new ObjectMapper());

    @Test
    void parsesCaptionCreatorUrlAndLocalizedSavedDate() {
        InstagramSavedPostsParser.ParsedImport result = parser.parse(
                savedPostsHtml(post(
                        "https://www.instagram.com/reel/synthetic/",
                        "pa\u017adziernika 24, 2026 13:30 po po\u0142udniu.",
                        "Synthetic caption",
                        "synthetic_creator")).getBytes(StandardCharsets.UTF_8),
                ZoneId.of("UTC"));

        assertTrue(result.errors().isEmpty());
        assertEquals(1, result.posts().size());
        InstagramSavedPostsParser.ParsedPost post = result.posts().getFirst();
        assertEquals(
                "https://www.instagram.com/reel/synthetic",
                post.canonicalUrl());
        assertEquals(Instant.parse("2026-10-24T13:30:00Z"), post.savedAt());
        assertEquals("Synthetic caption", post.sourceMetadata().get("caption").asText());
        assertEquals("synthetic_creator", post.sourceMetadata().get("creatorUsername").asText());
    }

    @Test
    void parsesMorningNoonAndUsesTheSuppliedTimeZone() {
        InstagramSavedPostsParser.ParsedImport result = parser.parse(
                savedPostsHtml(
                        post(
                                "https://www.instagram.com/p/morning/",
                                "Oct 24, 2026 12:15 rano",
                                null,
                                null),
                        post(
                                "https://www.instagram.com/p/afternoon/",
                                "Oct 24, 2026 3:15 po po\u0142udniu",
                                null,
                                null))
                        .getBytes(StandardCharsets.UTF_8),
                ZoneId.of("Europe/Warsaw"));

        assertTrue(result.errors().isEmpty());
        assertEquals(Instant.parse("2026-10-23T22:15:00Z"), result.posts().get(0).savedAt());
        assertEquals(Instant.parse("2026-10-24T13:15:00Z"), result.posts().get(1).savedAt());
        assertNull(result.posts().get(0).sourceMetadata().get("creatorUsername"));
    }

    @Test
    void reportsInvalidRecordsWithoutDiscardingValidRecords() {
        InstagramSavedPostsParser.ParsedImport result = parser.parse(
                savedPostsHtml(
                        post(
                                "https://www.instagram.com/p/valid/",
                                "Oct 24, 2026 10:30 rano",
                                "A caption",
                                null),
                        post(
                                "https://www.instagram.com/p/invalid/",
                                "not a saved date",
                                "Another caption",
                                null))
                        .getBytes(StandardCharsets.UTF_8),
                ZoneId.of("UTC"));

        assertEquals(1, result.posts().size());
        assertEquals(1, result.errors().size());
        assertEquals(2, result.errors().getFirst().recordIndex());
        assertEquals("invalid_timestamp", result.errors().getFirst().code());
    }

    @Test
    void rejectsUnsupportedHtmlAndJsonWithoutEchoingInput() {
        ImportValidationException exception = assertThrows(
                ImportValidationException.class,
                () -> parser.parse(
                        "<html><body>synthetic unsupported data</body></html>"
                                .getBytes(StandardCharsets.UTF_8),
                        ZoneId.of("UTC")));

        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, exception.getStatus());
        assertTrue(exception.getMessage().contains("saved_posts.html"));
        assertTrue(!exception.getMessage().contains("synthetic unsupported data"));
    }

    @Test
    void rejectsUnsafeOrUnsupportedInstagramLinks() {
        InstagramSavedPostsParser.ParsedImport result = parser.parse(
                savedPostsHtml(post(
                        "https://instagram.com.evil.example/p/synthetic/",
                        "Oct 24, 2026 10:30 rano",
                        "Synthetic caption",
                        null)).getBytes(StandardCharsets.UTF_8),
                ZoneId.of("UTC"));

        assertTrue(result.posts().isEmpty());
        assertEquals("invalid_post_url", result.errors().getFirst().code());
    }

    @Test
    void ignoresUnrelatedLinksInTheUrlFieldWhenThePostLinkIsValid() {
        String record = post(
                "https://www.instagram.com/p/synthetic/",
                "Oct 24, 2026 10:30 AM",
                "Synthetic caption",
                null).replace(
                "</a></td>",
                "</a> <a href=\"https://www.instagram.com/synthetic_creator/\">Profile</a></td>");
        InstagramSavedPostsParser.ParsedImport result = parser.parse(
                savedPostsHtml(record).getBytes(StandardCharsets.UTF_8),
                ZoneId.of("UTC"));

        assertTrue(result.errors().isEmpty());
        assertEquals(1, result.posts().size());
        assertEquals("https://www.instagram.com/p/synthetic", result.posts().getFirst().canonicalUrl());
    }

    private String savedPostsHtml(String... records) {
        return "<html><body><main class=\"_a706\">"
                + String.join("", records)
                + "</main></body></html>";
    }

    private String post(String url, String savedDate, String caption, String username) {
        return """
                <div class="_a6-g">
                  <div class="_3-94 _a6-o">%s</div>
                  <table><tbody>
                    <tr><td colspan="2" class="_a6_q">Adres URL <a href="%s">%s</a></td></tr>
                    %s
                    %s
                  </tbody></table>
                </div>
                """.formatted(
                savedDate,
                url,
                url,
                caption == null ? "" : field("Napisy", caption),
                username == null ? "" : field("Nazwa u\u017cytkownika", username));
    }

    private String field(String label, String value) {
        return "<tr><td class=\"_a6_q\">" + label + "</td><td class=\"_2piu _a6_r\">"
                + value + "</td></tr>";
    }
}
