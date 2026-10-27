package com.reelnest.watchsession;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import java.util.stream.IntStream;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class WatchSessionIntegrationTest {

    @DynamicPropertySource
    static void configureTestEnvironment(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", WatchSessionIntegrationTest::testDatabaseUrl);
        registry.add("spring.flyway.schemas", () -> "reelnest_watch_session_test");
        registry.add("spring.flyway.default-schema", () -> "reelnest_watch_session_test");
        registry.add("reelnest.auth.username", () -> "watch-session-test-user");
        registry.add("reelnest.auth.password", () -> "watch-session-test-password-long-enough");
    }

    private static String testDatabaseUrl() {
        String databaseUrl = System.getenv().getOrDefault(
                "REELNEST_TEST_DATABASE_URL",
                "jdbc:postgresql://localhost:5432/reelnest_dev");
        String separator = databaseUrl.contains("?") ? "&" : "?";
        return databaseUrl + separator + "currentSchema=reelnest_watch_session_test";
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void clearDatabase() {
        jdbcTemplate.execute(
                "TRUNCATE TABLE import_jobs, watch_session_posts, watch_sessions, post_view_history, "
                        + "post_categories, categories, collection_posts, collections, post_notes, post_favorites, posts");
    }

    @Test
    void createsOrderedSessionsListsThemAndPersistsProgressAndCompletion() throws Exception {
        UUID firstPost = insertPost(1);
        UUID secondPost = insertPost(2);
        UUID thirdPost = insertPost(3);
        MockHttpSession session = authenticatedSession();
        UUID sessionId = createSession(session, "  A deliberate set  ", firstPost, secondPost, thirdPost);

        mockMvc.perform(get("/api/watch-sessions").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].name").value("A deliberate set"))
                .andExpect(jsonPath("$[0].postCount").value(3))
                .andExpect(jsonPath("$[0].currentPosition").value(0));
        mockMvc.perform(get("/api/watch-sessions/{sessionId}", sessionId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.posts", hasSize(3)))
                .andExpect(jsonPath("$.posts[0].id").value(firstPost.toString()))
                .andExpect(jsonPath("$.posts[1].id").value(secondPost.toString()))
                .andExpect(jsonPath("$.posts[2].id").value(thirdPost.toString()))
                .andExpect(jsonPath("$.currentPosition").value(0))
                .andExpect(jsonPath("$.completedAt").doesNotExist());

        updateProgress(session, sessionId, 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentPosition").value(1))
                .andExpect(jsonPath("$.completedAt").doesNotExist());
        updateProgress(session, sessionId, 3)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentPosition").value(3))
                .andExpect(jsonPath("$.completedAt").isNotEmpty());
        updateProgress(session, sessionId, 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentPosition").value(0))
                .andExpect(jsonPath("$.completedAt").doesNotExist());
    }

    @Test
    void validatesSessionCreationAndProgress() throws Exception {
        UUID postId = insertPost(1);
        MockHttpSession session = authenticatedSession();

        createSessionRequest(session, "Valid", new UUID[0]).andExpect(status().isBadRequest());
        createSessionRequest(session, "Valid", postId, postId).andExpect(status().isBadRequest());
        createSessionRequest(session, "x".repeat(81), postId).andExpect(status().isBadRequest());
        createSessionRequest(session, "Bad\nname", postId).andExpect(status().isBadRequest());
        UUID[] tooManyPosts = IntStream.range(0, 101).mapToObj(ignored -> UUID.randomUUID()).toArray(UUID[]::new);
        createSessionRequest(session, "Too many", tooManyPosts).andExpect(status().isBadRequest());
        createSessionRequest(session, "Valid", UUID.randomUUID()).andExpect(status().isBadRequest());
        UUID sessionId = createSession(session, null, postId);
        updateProgress(session, sessionId, -1).andExpect(status().isBadRequest());
        updateProgress(session, sessionId, 2).andExpect(status().isBadRequest());
        updateProgress(session, UUID.randomUUID(), 0).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/watch-sessions/{sessionId}", UUID.randomUUID()).session(session))
                .andExpect(status().isNotFound());
    }

    @Test
    void requiresAuthenticationAndCsrfForSessionOperations() throws Exception {
        UUID postId = insertPost(1);
        UUID missingSessionId = UUID.randomUUID();
        mockMvc.perform(get("/api/watch-sessions")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/watch-sessions/{sessionId}", missingSessionId)).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/watch-sessions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"postIds\":[]}"))
                .andExpect(status().isForbidden());

        MockHttpSession anonymous = new MockHttpSession();
        mockMvc.perform(get("/api/auth/csrf").session(anonymous)).andExpect(status().isOk());
        mockMvc.perform(post("/api/watch-sessions")
                        .session(anonymous)
                        .header("X-CSRF-TOKEN", csrfToken(anonymous))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new CreateRequest(null, new UUID[]{postId}))))
                .andExpect(status().isUnauthorized());

        MockHttpSession authenticated = authenticatedSession();
        mockMvc.perform(post("/api/watch-sessions")
                        .session(authenticated)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new CreateRequest(null, new UUID[]{postId}))))
                .andExpect(status().isForbidden());
        UUID createdSessionId = createSession(authenticated, null, postId);
        mockMvc.perform(put("/api/watch-sessions/{sessionId}/progress", createdSessionId)
                        .session(authenticated)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPosition\":0}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void preservesSessionOrderAndProgressWhenAPostIsReimported() throws Exception {
        UUID firstPost = insertPost(1);
        UUID secondPost = insertPost(2);
        MockHttpSession session = authenticatedSession();
        UUID watchSessionId = createSession(session, "Import-safe session", firstPost, secondPost);
        updateProgress(session, watchSessionId, 1).andExpect(status().isOk());

        String export = savedPostsHtml(htmlPost(
                "https://www.instagram.com/p/synthetic-watch-session-post-1/",
                "Oct 24, 2026 10:30 AM",
                "changed metadata"));
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "saved_posts.html",
                MediaType.TEXT_HTML_VALUE,
                export.getBytes(StandardCharsets.UTF_8));
        mockMvc.perform(MockMvcRequestBuilders.multipart("/api/imports")
                        .file(file)
                        .param("timeZone", "UTC")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isCreated());

        mockMvc.perform(get("/api/watch-sessions/{sessionId}", watchSessionId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.posts", hasSize(2)))
                .andExpect(jsonPath("$.posts[0].id").value(firstPost.toString()))
                .andExpect(jsonPath("$.posts[1].id").value(secondPost.toString()))
                .andExpect(jsonPath("$.currentPosition").value(1))
                .andExpect(jsonPath("$.completedAt").doesNotExist());
    }

    private UUID insertPost(int number) {
        UUID id = UUID.randomUUID();
        String identifier = "synthetic-watch-session-post-" + number;
        String url = "https://www.instagram.com/p/" + identifier + "/";
        jdbcTemplate.update(
                "INSERT INTO posts (id, source_identifier, original_url, canonical_url, saved_at, source_metadata) "
                        + "VALUES (?, ?, ?, ?, ?, '[]'::jsonb)",
                id,
                identifier,
                url,
                url.substring(0, url.length() - 1),
                Timestamp.from(Instant.parse("2026-01-0" + number + "T00:00:00Z")));
        return id;
    }

    private UUID createSession(MockHttpSession session, String name, UUID... postIds) throws Exception {
        MvcResult result = createSessionRequest(session, name, postIds)
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode response = objectMapper.readTree(result.getResponse().getContentAsString());
        return UUID.fromString(response.get("id").asText());
    }

    private org.springframework.test.web.servlet.ResultActions createSessionRequest(
            MockHttpSession session,
            String name,
            UUID... postIds) throws Exception {
        return mockMvc.perform(post("/api/watch-sessions")
                .session(session)
                .header("X-CSRF-TOKEN", csrfToken(session))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new CreateRequest(name, postIds))));
    }

    private org.springframework.test.web.servlet.ResultActions updateProgress(
            MockHttpSession session,
            UUID sessionId,
            int position) throws Exception {
        return mockMvc.perform(put("/api/watch-sessions/{sessionId}/progress", sessionId)
                .session(session)
                .header("X-CSRF-TOKEN", csrfToken(session))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPosition\":" + position + "}"));
    }

    private String savedPostsHtml(String record) {
        return "<html><body><main class=\"_a706\">" + record + "</main></body></html>";
    }

    private String htmlPost(String url, String savedDate, String caption) {
        return """
                <div class="_a6-g">
                  <div class="_3-94 _a6-o">%s</div>
                  <table><tbody>
                    <tr><td colspan="2" class="_a6_q">Adres URL <a href="%s">%s</a></td></tr>
                    <tr><td class="_a6_q">Napisy</td><td class="_2piu _a6_r">%s</td></tr>
                  </tbody></table>
                </div>
                """.formatted(savedDate, url, url, caption);
    }

    private MockHttpSession authenticatedSession() throws Exception {
        MockHttpSession session = new MockHttpSession();
        mockMvc.perform(get("/api/auth/csrf").session(session)).andExpect(status().isOk());
        mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"watch-session-test-user","password":"watch-session-test-password-long-enough"}
                                """))
                .andExpect(status().isOk());
        return session;
    }

    private String csrfToken(MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/auth/csrf").session(session))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .get("token")
                .asText();
    }

    private record CreateRequest(String name, UUID[] postIds) {
    }
}
