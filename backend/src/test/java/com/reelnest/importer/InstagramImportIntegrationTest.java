package com.reelnest.importer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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
        registry.add("reelnest.auth.username", () -> "integration-user");
        registry.add("reelnest.auth.password", () -> "integration-password-long-enough");
        registry.add("reelnest.cors.allowed-origins", () -> "https://frontend.example.test");
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

    @Autowired
    private Environment environment;

    @BeforeEach
    void clearDatabase() {
        jdbcTemplate.execute("TRUNCATE TABLE import_jobs, post_notes, post_favorites, posts");
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
        mockMvc.perform(get("/api/imports/{importId}", importId)
                        .session(authenticatedSession()))
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
        setFavorite(postId, true);
        setNote(postId, "synthetic preserved note");

        upload(initial)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.addedCount").value(0))
                .andExpect(jsonPath("$.updatedCount").value(0))
                .andExpect(jsonPath("$.skippedCount").value(1));
        assertEquals(1, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM post_favorites", Integer.class));

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
                "synthetic preserved note",
                jdbcTemplate.queryForObject(
                        "SELECT note FROM post_notes WHERE post_id = ?",
                        String.class,
                        postId));
        assertEquals(
                "updated-metadata",
                jdbcTemplate.queryForObject(
                        "SELECT source_metadata #>> '{1,value}' FROM posts WHERE id = ?",
                        String.class,
                        postId));
        mockMvc.perform(get("/api/posts/{postId}", postId).session(authenticatedSession()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorite").value(true));
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

    @Test
    void unauthenticatedRequestsAreRejectedAndHealthRemainsPublic() throws Exception {
        mockMvc.perform(get("/api/imports/{importId}", UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk());
    }

    @Test
    void loginRequiresCsrfAuthenticatesAndRotatesTheSession() throws Exception {
        MvcResult csrfResult = mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) csrfResult.getRequest().getSession(false);
        String previousSessionId = session.getId();
        String csrfToken = objectMapper.readTree(csrfResult.getResponse().getContentAsString())
                .get("token").asText();

        mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"integration-user","password":"integration-password-long-enough"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));

        assertNotEquals(previousSessionId, session.getId());
        mockMvc.perform(get("/api/auth/session").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));
        mockMvc.perform(get("/api/imports/{importId}", UUID.randomUUID()).session(session))
                .andExpect(status().isNotFound());
    }

    @Test
    void invalidCredentialsAndMissingCsrfAreRejectedWithoutCredentialDetails() throws Exception {
        MvcResult csrfResult = mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) csrfResult.getRequest().getSession(false);

        mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"integration-user","password":"wrong-password"}
                                """))
                .andExpect(status().isForbidden());

        String csrfToken = objectMapper.readTree(csrfResult.getResponse().getContentAsString())
                .get("token").asText();
        mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"integration-user","password":"wrong-password"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("Username or password is incorrect."));

        mockMvc.perform(MockMvcRequestBuilders.post("/api/imports"))
                .andExpect(status().isForbidden());
    }

    @Test
    void logoutRequiresCsrfInvalidatesTheSessionAndExpiresProtectedAccess() throws Exception {
        MockHttpSession session = authenticatedSession();
        mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/logout").session(session))
                .andExpect(status().isForbidden());

        String csrfToken = csrfToken(session);
        mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/logout")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/imports/{importId}", UUID.randomUUID()).session(session))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/auth/session"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void corsPreflightAllowsOnlyTheConfiguredOrigin() throws Exception {
        mockMvc.perform(options("/api/imports")
                        .header("Origin", "https://frontend.example.test")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "content-type,x-csrf-token"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://frontend.example.test"))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));

        mockMvc.perform(options("/api/posts/synthetic-post-id/favorite")
                        .header("Origin", "https://frontend.example.test")
                        .header("Access-Control-Request-Method", "PUT")
                        .header("Access-Control-Request-Headers", "content-type,x-csrf-token"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://frontend.example.test"));

        mockMvc.perform(options("/api/posts/synthetic-post-id/notes")
                        .header("Origin", "https://frontend.example.test")
                        .header("Access-Control-Request-Method", "DELETE")
                        .header("Access-Control-Request-Headers", "x-csrf-token"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://frontend.example.test"));

        mockMvc.perform(options("/api/imports")
                        .header("Origin", "https://untrusted.example.test")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden());
    }

    @Test
    void sessionCookieDefaultsToSecureHttpOnlyAndSameSiteStrict() {
        assertEquals("true", environment.getProperty("server.servlet.session.cookie.secure"));
        assertEquals("true", environment.getProperty("server.servlet.session.cookie.http-only"));
        assertEquals("strict", environment.getProperty("server.servlet.session.cookie.same-site"));
        assertEquals("30m", environment.getProperty("server.servlet.session.timeout"));
    }

    private MockHttpSession authenticatedSession() throws Exception {
        MvcResult csrfResult = mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) csrfResult.getRequest().getSession(false);
        String csrfToken = objectMapper.readTree(csrfResult.getResponse().getContentAsString())
                .get("token").asText();
        mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"integration-user","password":"integration-password-long-enough"}
                                """))
                .andExpect(status().isOk());
        return session;
    }

    private String csrfToken(MockHttpSession session) throws Exception {
        MvcResult csrfResult = mockMvc.perform(get("/api/auth/csrf").session(session))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(csrfResult.getResponse().getContentAsString())
                .get("token").asText();
    }

    private void setFavorite(UUID postId, boolean favorite) throws Exception {
        MockHttpSession session = authenticatedSession();
        mockMvc.perform(MockMvcRequestBuilders.put("/api/posts/{postId}/favorite", postId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"favorite\":" + favorite + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorite").value(favorite));
    }

    private void setNote(UUID postId, String note) throws Exception {
        MockHttpSession session = authenticatedSession();
        mockMvc.perform(MockMvcRequestBuilders.put("/api/posts/{postId}/notes", postId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(java.util.Map.of("note", note))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.note").value(note));
    }

    private ResultActions upload(byte[] content) throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "saved_posts.json",
                MediaType.APPLICATION_JSON_VALUE,
                content);
        MockHttpSession session = authenticatedSession();
        String csrfToken = csrfToken(session);
        return mockMvc.perform(MockMvcRequestBuilders.multipart("/api/imports")
                .file(file)
                .session(session)
                .header("X-CSRF-TOKEN", csrfToken));
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
