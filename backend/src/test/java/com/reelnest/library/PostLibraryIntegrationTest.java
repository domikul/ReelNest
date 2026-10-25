package com.reelnest.library;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class PostLibraryIntegrationTest {

    @DynamicPropertySource
    static void configureTestEnvironment(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PostLibraryIntegrationTest::testDatabaseUrl);
        registry.add("spring.flyway.schemas", () -> "reelnest_library_test");
        registry.add("spring.flyway.default-schema", () -> "reelnest_library_test");
        registry.add("reelnest.auth.username", () -> "library-test-user");
        registry.add("reelnest.auth.password", () -> "library-test-password-long-enough");
    }

    private static String testDatabaseUrl() {
        String databaseUrl = System.getenv().getOrDefault(
                "REELNEST_TEST_DATABASE_URL",
                "jdbc:postgresql://localhost:5432/reelnest_dev");
        String separator = databaseUrl.contains("?") ? "&" : "?";
        return databaseUrl + separator + "currentSchema=reelnest_library_test";
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void clearDatabase() {
        jdbcTemplate.execute("TRUNCATE TABLE import_jobs, post_notes, post_favorites, posts");
    }

    @Test
    void listsPostsInStableSavedDateOrderWithServerPagination() throws Exception {
        UUID oldestId = insertPost(1, "2026-01-01T00:00:00Z");
        UUID middleId = insertPost(2, "2026-01-02T00:00:00Z");
        insertPost(3, "2026-01-03T00:00:00Z");
        MockHttpSession session = authenticatedSession();

        mockMvc.perform(get("/api/posts")
                        .param("page", "0")
                        .param("size", "2")
                        .session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.hasNext").value(true))
                .andExpect(jsonPath("$.hasPrevious").value(false))
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].savedAt").value("2026-01-03T00:00:00Z"))
                .andExpect(jsonPath("$.items[1].id").value(middleId.toString()))
                .andExpect(jsonPath("$.items[0].sourceMetadata").doesNotExist());

        mockMvc.perform(get("/api/posts")
                        .param("page", "1")
                        .param("size", "2")
                        .session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(oldestId.toString()))
                .andExpect(jsonPath("$.hasNext").value(false))
                .andExpect(jsonPath("$.hasPrevious").value(true));
    }

    @Test
    void returnsEmptyLibraryAndOutOfRangePageStates() throws Exception {
        MockHttpSession session = authenticatedSession();

        mockMvc.perform(get("/api/posts").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0))
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.totalPages").value(0));

        insertPost(1, "2026-01-01T00:00:00Z");
        mockMvc.perform(get("/api/posts")
                        .param("page", "9")
                        .session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.hasPrevious").value(true));
    }

    @Test
    void returnsPostDetailsAndNotFoundForUnknownPosts() throws Exception {
        UUID postId = insertPost(1, "2026-02-12T10:15:30Z");
        MockHttpSession session = authenticatedSession();

        mockMvc.perform(get("/api/posts/{postId}", postId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(postId.toString()))
                .andExpect(jsonPath("$.originalUrl")
                        .value("https://www.instagram.com/p/synthetic-post-1/"))
                .andExpect(jsonPath("$.savedAt").value("2026-02-12T10:15:30Z"))
                .andExpect(jsonPath("$.caption").doesNotExist());

        mockMvc.perform(get("/api/posts/{postId}", UUID.randomUUID()).session(session))
                .andExpect(status().isNotFound());
    }

    @Test
    void setsAndRemovesFavoritesIdempotentlyAndReturnsPersistentState() throws Exception {
        UUID postId = insertPost(1, "2026-02-12T10:15:30Z");
        MockHttpSession session = authenticatedSession();

        setFavorite(session, postId, true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorite").value(true));
        setFavorite(session, postId, true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorite").value(true));
        mockMvc.perform(get("/api/posts/{postId}", postId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorite").value(true));
        mockMvc.perform(get("/api/posts").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].favorite").value(true));
        assertEquals(1, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM post_favorites", Integer.class));

        setFavorite(session, postId, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorite").value(false));
        setFavorite(session, postId, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorite").value(false));
        mockMvc.perform(get("/api/posts/{postId}", postId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.favorite").value(false));
        assertEquals(0, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM post_favorites", Integer.class));
    }

    @Test
    void createsUpdatesAndRemovesPersonalNotesPersistently() throws Exception {
        UUID postId = insertPost(1, "2026-02-12T10:15:30Z");
        MockHttpSession session = authenticatedSession();

        mockMvc.perform(get("/api/posts/{postId}/notes", postId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.postId").value(postId.toString()))
                .andExpect(jsonPath("$.note").value(nullValue()))
                .andExpect(jsonPath("$.updatedAt").value(nullValue()));

        setNote(session, postId, "synthetic note version one")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.note").value("synthetic note version one"));
        setNote(session, postId, "synthetic note version two")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.note").value("synthetic note version two"))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());

        mockMvc.perform(get("/api/posts/{postId}/notes", postId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.note").value("synthetic note version two"));
        assertEquals(1, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM post_notes", Integer.class));

        mockMvc.perform(delete("/api/posts/{postId}/notes", postId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/posts/{postId}/notes", postId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.note").value(nullValue()));
        mockMvc.perform(delete("/api/posts/{postId}/notes", postId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNoContent());
        assertEquals(0, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM post_notes", Integer.class));
    }

    @Test
    void protectsNoteOperationsAndValidatesNoteInputAndPostExistence() throws Exception {
        UUID postId = insertPost(1, "2026-02-12T10:15:30Z");
        UUID missingPostId = UUID.randomUUID();
        mockMvc.perform(get("/api/posts/{postId}/notes", postId))
                .andExpect(status().isUnauthorized());

        MockHttpSession anonymousSession = new MockHttpSession();
        String anonymousCsrfToken = csrfToken(anonymousSession);
        mockMvc.perform(put("/api/posts/{postId}/notes", postId)
                        .session(anonymousSession)
                        .header("X-CSRF-TOKEN", anonymousCsrfToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"synthetic note\"}"))
                .andExpect(status().isUnauthorized());

        MockHttpSession session = authenticatedSession();
        mockMvc.perform(put("/api/posts/{postId}/notes", postId)
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"synthetic note\"}"))
                .andExpect(status().isForbidden());
        setNote(session, postId, "   ").andExpect(status().isBadRequest());
        setNote(session, postId, "x".repeat(5001)).andExpect(status().isBadRequest());
        setNote(session, postId, null).andExpect(status().isBadRequest());

        mockMvc.perform(get("/api/posts/{postId}/notes", missingPostId).session(session))
                .andExpect(status().isNotFound());
        setNote(session, missingPostId, "synthetic note").andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/posts/{postId}/notes", missingPostId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNotFound());
        assertEquals(0, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM post_notes", Integer.class));
    }

    @Test
    void protectsBothLibraryEndpointsAndRejectsInvalidPagination() throws Exception {
        UUID postId = insertPost(1, "2026-01-01T00:00:00Z");
        mockMvc.perform(get("/api/posts"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/posts/{postId}", postId))
                .andExpect(status().isUnauthorized());

        var csrfResult = mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession anonymousSession = (MockHttpSession) csrfResult.getRequest().getSession(false);
        String csrfToken = objectMapper.readTree(csrfResult.getResponse().getContentAsString())
                .get("token").asText();
        mockMvc.perform(put("/api/posts/{postId}/favorite", postId)
                        .session(anonymousSession)
                        .header("X-CSRF-TOKEN", csrfToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"favorite\":true}"))
                .andExpect(status().isUnauthorized());

        MockHttpSession session = authenticatedSession();
        mockMvc.perform(put("/api/posts/{postId}/favorite", postId)
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"favorite\":true}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/posts").param("page", "-1").session(session))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/posts").param("size", "101").session(session))
                .andExpect(status().isBadRequest());
    }

    @Test
    void favoriteEndpointReturnsNotFoundAndValidatesRequestBody() throws Exception {
        MockHttpSession session = authenticatedSession();
        UUID missingPostId = UUID.randomUUID();
        mockMvc.perform(put("/api/posts/{postId}/favorite", missingPostId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"favorite\":true}"))
                .andExpect(status().isNotFound());

        UUID postId = insertPost(1, "2026-01-01T00:00:00Z");
        mockMvc.perform(put("/api/posts/{postId}/favorite", postId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    private UUID insertPost(int number, String savedAt) {
        UUID id = UUID.randomUUID();
        String identifier = "synthetic-library-post-" + number;
        String url = "https://www.instagram.com/p/synthetic-post-" + number + "/";
        jdbcTemplate.update(
                "INSERT INTO posts (id, source_identifier, original_url, canonical_url, saved_at, source_metadata) "
                        + "VALUES (?, ?, ?, ?, ?, '[]'::jsonb)",
                id,
                identifier,
                url,
                url.substring(0, url.length() - 1),
                Timestamp.from(Instant.parse(savedAt)));
        return id;
    }

    private MockHttpSession authenticatedSession() throws Exception {
        var csrfResult = mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) csrfResult.getRequest().getSession(false);
        String csrfToken = objectMapper.readTree(csrfResult.getResponse().getContentAsString())
                .get("token").asText();
        mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"library-test-user","password":"library-test-password-long-enough"}
                                """))
                .andExpect(status().isOk());
        return session;
    }

    private ResultActions setFavorite(MockHttpSession session, UUID postId, boolean favorite) throws Exception {
        return mockMvc.perform(put("/api/posts/{postId}/favorite", postId)
                .session(session)
                .header("X-CSRF-TOKEN", csrfToken(session))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"favorite\":" + favorite + "}"));
    }

    private ResultActions setNote(MockHttpSession session, UUID postId, String note) throws Exception {
        String serializedNote = note == null ? "null" : objectMapper.writeValueAsString(note);
        return mockMvc.perform(put("/api/posts/{postId}/notes", postId)
                .session(session)
                .header("X-CSRF-TOKEN", csrfToken(session))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"note\":" + serializedNote + "}"));
    }

    private String csrfToken(MockHttpSession session) throws Exception {
        var csrfResult = mockMvc.perform(get("/api/auth/csrf").session(session))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(csrfResult.getResponse().getContentAsString())
                .get("token").asText();
    }
}
