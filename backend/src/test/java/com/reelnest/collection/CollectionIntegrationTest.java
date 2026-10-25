package com.reelnest.collection;

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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CollectionIntegrationTest {

    @DynamicPropertySource
    static void configureTestEnvironment(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", CollectionIntegrationTest::testDatabaseUrl);
        registry.add("spring.flyway.schemas", () -> "reelnest_collection_test");
        registry.add("spring.flyway.default-schema", () -> "reelnest_collection_test");
        registry.add("reelnest.auth.username", () -> "collection-test-user");
        registry.add("reelnest.auth.password", () -> "collection-test-password-long-enough");
    }

    private static String testDatabaseUrl() {
        String databaseUrl = System.getenv().getOrDefault(
                "REELNEST_TEST_DATABASE_URL",
                "jdbc:postgresql://localhost:5432/reelnest_dev");
        String separator = databaseUrl.contains("?") ? "&" : "?";
        return databaseUrl + separator + "currentSchema=reelnest_collection_test";
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
                "TRUNCATE TABLE import_jobs, collection_posts, collections, post_categories, categories, "
                        + "post_notes, post_favorites, posts");
    }

    @Test
    void createsListsRenamesAndDeletesCollections() throws Exception {
        MockHttpSession session = authenticatedSession();
        MvcResult createResult = createCollectionRequest(session, "  Synthetic collection  ")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Synthetic collection"))
                .andExpect(jsonPath("$.postCount").value(0))
                .andReturn();
        UUID collectionId = collectionId(createResult);

        mockMvc.perform(get("/api/collections").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].id").value(collectionId.toString()));
        mockMvc.perform(put("/api/collections/{collectionId}", collectionId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Updated collection\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Updated collection"));

        mockMvc.perform(delete("/api/collections/{collectionId}", collectionId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/collections").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
        mockMvc.perform(delete("/api/collections/{collectionId}", collectionId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNotFound());
    }

    @Test
    void validatesNamesAndPaginationAndRejectsCaseInsensitiveDuplicates() throws Exception {
        MockHttpSession session = authenticatedSession();
        createCollection(session, "Trip ideas");

        createCollectionRequest(session, "  ").andExpect(status().isBadRequest());
        createCollectionRequest(session, "x".repeat(81)).andExpect(status().isBadRequest());
        createCollectionRequest(session, "TRIP IDEAS").andExpect(status().isConflict());
        mockMvc.perform(get("/api/collections/{collectionId}/posts", UUID.randomUUID())
                        .session(session)
                        .param("page", "-1"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/collections/{collectionId}/posts", UUID.randomUUID())
                        .session(session)
                        .param("size", "101"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(put("/api/collections/{collectionId}", UUID.randomUUID())
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Missing\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void managesMembershipsForMultipleCollectionsAndPaginatesCollectionPosts() throws Exception {
        UUID firstPost = insertPost(1, "2026-01-01T00:00:00Z");
        UUID secondPost = insertPost(2, "2026-01-02T00:00:00Z");
        UUID thirdPost = insertPost(3, "2026-01-03T00:00:00Z");
        MockHttpSession session = authenticatedSession();
        UUID firstCollection = createCollection(session, "Synthetic collection one");
        UUID secondCollection = createCollection(session, "Synthetic collection two");

        assignPost(session, firstCollection, firstPost);
        assignPost(session, firstCollection, secondPost);
        assignPost(session, secondCollection, firstPost);
        assignPost(session, secondCollection, firstPost);

        mockMvc.perform(get("/api/collections").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].postCount").value(2))
                .andExpect(jsonPath("$[1].postCount").value(1));
        mockMvc.perform(get("/api/posts/{postId}/collections", firstPost).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)));

        mockMvc.perform(get("/api/collections/{collectionId}/posts", firstCollection)
                        .session(session)
                        .param("page", "0")
                        .param("size", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(secondPost.toString()));
        mockMvc.perform(get("/api/collections/{collectionId}/posts", firstCollection)
                        .session(session)
                        .param("page", "1")
                        .param("size", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(firstPost.toString()));

        mockMvc.perform(delete(
                                "/api/posts/{postId}/collections/{collectionId}", firstPost, firstCollection)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].id").value(secondCollection.toString()));
        mockMvc.perform(delete("/api/collections/{collectionId}", secondCollection)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNoContent());
        assertEquals(
                0,
                jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM collection_posts WHERE collection_id = ?",
                        Integer.class,
                        secondCollection));
    }

    @Test
    void protectsCollectionAndMembershipOperationsAndReportsMissingResources() throws Exception {
        UUID postId = insertPost(1, "2026-01-01T00:00:00Z");
        mockMvc.perform(get("/api/collections")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/collections/{collectionId}/posts", UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/posts/{postId}/collections", postId))
                .andExpect(status().isUnauthorized());

        MockHttpSession anonymousSession = new MockHttpSession();
        mockMvc.perform(post("/api/collections")
                        .session(anonymousSession)
                        .header("X-CSRF-TOKEN", csrfToken(anonymousSession))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Synthetic\"}"))
                .andExpect(status().isUnauthorized());

        MockHttpSession session = authenticatedSession();
        mockMvc.perform(post("/api/collections")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Synthetic\"}"))
                .andExpect(status().isForbidden());
        UUID collectionId = createCollection(session, "Synthetic");
        mockMvc.perform(put(
                                "/api/posts/{postId}/collections/{collectionId}", postId, collectionId)
                        .session(session))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/collections/{collectionId}/posts", UUID.randomUUID())
                        .session(session))
                .andExpect(status().isNotFound());
        mockMvc.perform(put(
                                "/api/posts/{postId}/collections/{collectionId}", UUID.randomUUID(), collectionId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNotFound());
        mockMvc.perform(put(
                                "/api/posts/{postId}/collections/{collectionId}", postId, UUID.randomUUID())
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNotFound());
    }

    private org.springframework.test.web.servlet.ResultActions createCollectionRequest(
            MockHttpSession session,
            String name) throws Exception {
        return mockMvc.perform(post("/api/collections")
                .session(session)
                .header("X-CSRF-TOKEN", csrfToken(session))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", name))));
    }

    private UUID createCollection(MockHttpSession session, String name) throws Exception {
        return collectionId(createCollectionRequest(session, name)
                .andExpect(status().isCreated())
                .andReturn());
    }

    private UUID collectionId(MvcResult result) throws Exception {
        JsonNode response = objectMapper.readTree(result.getResponse().getContentAsString());
        return UUID.fromString(response.get("id").asText());
    }

    private void assignPost(MockHttpSession session, UUID collectionId, UUID postId) throws Exception {
        mockMvc.perform(put(
                                "/api/posts/{postId}/collections/{collectionId}", postId, collectionId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isOk());
    }

    private UUID insertPost(int number, String savedAt) {
        UUID id = UUID.randomUUID();
        String identifier = "synthetic-collection-post-" + number;
        String url = "https://www.instagram.com/p/" + identifier + "/";
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
        MockHttpSession session = new MockHttpSession();
        mockMvc.perform(get("/api/auth/csrf").session(session)).andExpect(status().isOk());
        String token = csrfToken(session);
        mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header("X-CSRF-TOKEN", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"collection-test-user","password":"collection-test-password-long-enough"}
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
}
