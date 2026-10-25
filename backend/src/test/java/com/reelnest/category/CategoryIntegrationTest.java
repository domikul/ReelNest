package com.reelnest.category;

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
class CategoryIntegrationTest {

    @DynamicPropertySource
    static void configureTestEnvironment(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", CategoryIntegrationTest::testDatabaseUrl);
        registry.add("spring.flyway.schemas", () -> "reelnest_category_test");
        registry.add("spring.flyway.default-schema", () -> "reelnest_category_test");
        registry.add("reelnest.auth.username", () -> "category-test-user");
        registry.add("reelnest.auth.password", () -> "category-test-password-long-enough");
    }

    private static String testDatabaseUrl() {
        String databaseUrl = System.getenv().getOrDefault(
                "REELNEST_TEST_DATABASE_URL",
                "jdbc:postgresql://localhost:5432/reelnest_dev");
        String separator = databaseUrl.contains("?") ? "&" : "?";
        return databaseUrl + separator + "currentSchema=reelnest_category_test";
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
                "TRUNCATE TABLE import_jobs, post_categories, categories, post_notes, post_favorites, posts");
    }

    @Test
    void createsListsRenamesAndDeletesCategories() throws Exception {
        MockHttpSession session = authenticatedSession();
        MvcResult createResult = mockMvc.perform(post("/api/categories")
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"  Synthetic ideas  \"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Synthetic ideas"))
                .andReturn();
        UUID categoryId = UUID.fromString(objectMapper.readTree(
                createResult.getResponse().getContentAsString()).get("id").asText());

        mockMvc.perform(get("/api/categories").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].id").value(categoryId.toString()));

        mockMvc.perform(put("/api/categories/{categoryId}", categoryId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Updated ideas\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Updated ideas"));

        mockMvc.perform(delete("/api/categories/{categoryId}", categoryId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/categories").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
        mockMvc.perform(delete("/api/categories/{categoryId}", categoryId)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNotFound());
    }

    @Test
    void validatesCategoryNamesAndRejectsCaseInsensitiveDuplicates() throws Exception {
        MockHttpSession session = authenticatedSession();
        createCategory(session, "Ideas");

        createCategoryRequest(session, "  ").andExpect(status().isBadRequest());
        createCategoryRequest(session, "x".repeat(81)).andExpect(status().isBadRequest());
        createCategoryRequest(session, "ideas").andExpect(status().isConflict());
        mockMvc.perform(put("/api/categories/{categoryId}", UUID.randomUUID())
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Unknown\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void assignsAndRemovesMultipleCategoriesAndCascadesCategoryDeletion() throws Exception {
        UUID postId = insertPost();
        MockHttpSession session = authenticatedSession();
        UUID firstCategory = createCategory(session, "Synthetic one");
        UUID secondCategory = createCategory(session, "Synthetic two");

        mockMvc.perform(get("/api/posts/{postId}/categories", postId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
        assignCategory(session, postId, firstCategory)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)));
        assignCategory(session, postId, firstCategory)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)));
        assignCategory(session, postId, secondCategory)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)));
        assertEquals(2, jdbcTemplate.queryForObject("SELECT COUNT(*) FROM post_categories", Integer.class));

        mockMvc.perform(delete(
                                "/api/posts/{postId}/categories/{categoryId}", postId, firstCategory)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].id").value(secondCategory.toString()));
        mockMvc.perform(delete("/api/categories/{categoryId}", secondCategory)
                        .session(session)
                        .header("X-CSRF-TOKEN", csrfToken(session)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/posts/{postId}/categories", postId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void protectsCategoryAndAssignmentOperationsAndRejectsMissingResources() throws Exception {
        UUID postId = insertPost();
        UUID missingCategoryId = UUID.randomUUID();
        mockMvc.perform(get("/api/categories")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/posts/{postId}/categories", postId))
                .andExpect(status().isUnauthorized());

        MockHttpSession anonymousSession = new MockHttpSession();
        mockMvc.perform(post("/api/categories")
                        .session(anonymousSession)
                        .header("X-CSRF-TOKEN", csrfToken(anonymousSession))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Synthetic\"}"))
                .andExpect(status().isUnauthorized());

        MockHttpSession session = authenticatedSession();
        mockMvc.perform(post("/api/categories")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Synthetic\"}"))
                .andExpect(status().isForbidden());

        UUID categoryId = createCategory(session, "Synthetic");
        mockMvc.perform(put(
                                "/api/posts/{postId}/categories/{categoryId}", postId, categoryId)
                        .session(session))
                .andExpect(status().isForbidden());
        assignCategory(session, postId, missingCategoryId).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/posts/{postId}/categories", UUID.randomUUID()).session(session))
                .andExpect(status().isNotFound());
    }

    private UUID createCategory(MockHttpSession session, String name) throws Exception {
        MvcResult result = createCategoryRequest(session, name)
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode response = objectMapper.readTree(result.getResponse().getContentAsString());
        return UUID.fromString(response.get("id").asText());
    }

    private org.springframework.test.web.servlet.ResultActions createCategoryRequest(
            MockHttpSession session,
            String name) throws Exception {
        return mockMvc.perform(post("/api/categories")
                .session(session)
                .header("X-CSRF-TOKEN", csrfToken(session))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", name))));
    }

    private org.springframework.test.web.servlet.ResultActions assignCategory(
            MockHttpSession session,
            UUID postId,
            UUID categoryId) throws Exception {
        return mockMvc.perform(put(
                        "/api/posts/{postId}/categories/{categoryId}", postId, categoryId)
                .session(session)
                .header("X-CSRF-TOKEN", csrfToken(session)));
    }

    private UUID insertPost() {
        UUID id = UUID.randomUUID();
        String identifier = "synthetic-category-post-" + id;
        String url = "https://www.instagram.com/p/" + identifier + "/";
        jdbcTemplate.update(
                "INSERT INTO posts (id, source_identifier, original_url, canonical_url, saved_at, source_metadata) "
                        + "VALUES (?, ?, ?, ?, ?, '[]'::jsonb)",
                id,
                identifier,
                url,
                url.substring(0, url.length() - 1),
                Timestamp.from(Instant.parse("2026-01-01T00:00:00Z")));
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
                                {"username":"category-test-user","password":"category-test-password-long-enough"}
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
