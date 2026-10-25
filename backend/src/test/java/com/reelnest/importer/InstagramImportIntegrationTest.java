package com.reelnest.importer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class InstagramImportIntegrationTest {

    @DynamicPropertySource
    static void configureDataSource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", InstagramImportIntegrationTest::testDatabaseUrl);
        registry.add("spring.flyway.schemas", () -> "reelnest_import_test");
        registry.add("spring.flyway.default-schema", () -> "reelnest_import_test");
    }

    private static String testDatabaseUrl() {
        String databaseUrl = System.getenv().getOrDefault(
                "REELNEST_TEST_DATABASE_URL",
                "jdbc:postgresql://localhost:5432/reelnest_dev");
        String separator = databaseUrl.contains("?") ? "&" : "?";
        return databaseUrl + separator + "currentSchema=reelnest_import_test";
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void clearDatabase() {
        jdbcTemplate.execute("ALTER TABLE posts ADD COLUMN IF NOT EXISTS personal_note TEXT");
        jdbcTemplate.execute("TRUNCATE TABLE import_jobs, posts");
    }

    @Test
    void importsValidRecordsAndReportsDuplicatesAndInvalidRecords() throws Exception {
        ObjectNode valid = post("synthetic-id-1", "https://www.instagram.com/p/synthetic-1/", "value");
        ObjectNode invalid = post("synthetic-id-2", "https://www.instagram.com/p/synthetic-2/", "value");
        invalid.put("fbid", 42);
        ArrayNode records = objectMapper.createArrayNode()
                .add(valid)
                .add(valid.deepCopy())
                .add(invalid);

        MvcResult result = upload(objectMapper.writeValueAsBytes(records))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("COMPLETED_WITH_ERRORS"))
                .andExpect(jsonPath("$.addedCount").value(1))
                .andExpect(jsonPath("$.updatedCount").value(0))
                .andExpect(jsonPath("$.skippedCount").value(1))
                .andExpect(jsonPath("$.errorCount").value(1))
                .andExpect(jsonPath("$.errors[0].recordIndex").value(3))
                .andExpect(jsonPath("$.errors[0].code").value("invalid_identifier"))
                .andReturn();

        String importId = objectMapper.readTree(result.getResponse().getContentAsString())
                .get("importId")
                .asText();
        mockMvc.perform(MockMvcRequestBuilders.get("/api/imports/{importId}", importId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.addedCount").value(1))
                .andExpect(jsonPath("$.skippedCount").value(1))
                .andExpect(jsonPath("$.errorCount").value(1));

        assertEquals(1, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM posts", Integer.class));
        assertEquals(1, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM import_jobs", Integer.class));
    }

    @Test
    void reimportIsIdempotentAndSourceUpdatesPreservePersonalColumns() throws Exception {
        byte[] initial = objectMapper.writeValueAsBytes(
                objectMapper.createArrayNode().add(post(
                        "synthetic-id-1",
                        "https://www.instagram.com/p/synthetic-1/",
                        "initial-metadata")));
        upload(initial)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.addedCount").value(1));

        UUID postId = jdbcTemplate.queryForObject(
                "SELECT id FROM posts WHERE source_identifier = ?",
                UUID.class,
                "synthetic-id-1");
        jdbcTemplate.update("UPDATE posts SET personal_note = ? WHERE id = ?", "test-only-personal-state", postId);

        upload(initial)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.addedCount").value(0))
                .andExpect(jsonPath("$.updatedCount").value(0))
                .andExpect(jsonPath("$.skippedCount").value(1));

        byte[] changedMetadata = objectMapper.writeValueAsBytes(
                objectMapper.createArrayNode().add(post(
                        "synthetic-id-1",
                        "https://www.instagram.com/p/synthetic-1/",
                        "updated-metadata")));
        upload(changedMetadata)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.addedCount").value(0))
                .andExpect(jsonPath("$.updatedCount").value(1))
                .andExpect(jsonPath("$.skippedCount").value(0));

        assertEquals(
                "test-only-personal-state",
                jdbcTemplate.queryForObject(
                        "SELECT personal_note FROM posts WHERE id = ?",
                        String.class,
                        postId));
        assertEquals(
                "updated-metadata",
                jdbcTemplate.queryForObject(
                        "SELECT source_metadata #>> '{1,value}' FROM posts WHERE id = ?",
                        String.class,
                        postId));
        assertEquals(3, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM import_jobs", Integer.class));
    }

    @Test
    void malformedJsonReturnsClearValidationError() throws Exception {
        upload("{not-json}".getBytes(StandardCharsets.UTF_8))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Upload must contain valid JSON."));
    }

    @Test
    void unsupportedJsonShapeReturnsUnprocessableEntity() throws Exception {
        String collectionsShape = """
                [{
                  "fbid": "synthetic-collection-id",
                  "timestamp": 1700000000,
                  "label_values": [{"dict": [{"dict": [{"href": "https://www.instagram.com/p/synthetic/"}]}]}],
                  "media": []
                }]
                """;

        upload(collectionsShape.getBytes(StandardCharsets.UTF_8))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.detail").value(
                        "Unsupported export structure. This endpoint accepts the observed saved_posts.json format."));
    }

    private ResultActions upload(byte[] content) throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "saved_posts.json",
                MediaType.APPLICATION_JSON_VALUE,
                content);
        return mockMvc.perform(MockMvcRequestBuilders.multipart("/api/imports").file(file));
    }

    private ObjectNode post(String identifier, String url, String metadataValue) {
        ObjectNode record = objectMapper.createObjectNode();
        record.put("fbid", identifier);
        record.put("timestamp", 1700000000L);
        ArrayNode labelValues = objectMapper.createArrayNode();
        ObjectNode link = objectMapper.createObjectNode();
        link.put("href", url);
        labelValues.add(link);
        ObjectNode metadata = objectMapper.createObjectNode();
        metadata.put("label", "synthetic-label");
        metadata.put("value", metadataValue);
        labelValues.add(metadata);
        record.set("label_values", labelValues);
        record.set("media", objectMapper.createArrayNode());
        return record;
    }
}
