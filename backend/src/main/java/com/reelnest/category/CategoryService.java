package com.reelnest.category;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class CategoryService {

    private static final RowMapper<CategoryDto> CATEGORY_MAPPER = (resultSet, rowNumber) ->
            new CategoryDto(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("name"),
                    resultSet.getTimestamp("created_at").toInstant(),
                    resultSet.getTimestamp("updated_at").toInstant());

    private final JdbcTemplate jdbcTemplate;

    public CategoryService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<CategoryDto> findCategories() {
        return jdbcTemplate.query(
                "SELECT id, name, created_at, updated_at FROM categories ORDER BY LOWER(name), id",
                CATEGORY_MAPPER);
    }

    public CategoryDto createCategory(String name) {
        UUID id = UUID.randomUUID();
        try {
            jdbcTemplate.update("INSERT INTO categories (id, name) VALUES (?, ?)", id, name);
        } catch (DuplicateKeyException exception) {
            throw duplicateNameException();
        }
        return findCategory(id).orElseThrow(() ->
                new IllegalStateException("Created category could not be loaded."));
    }

    public Optional<CategoryDto> updateCategory(UUID id, String name) {
        try {
            int updated = jdbcTemplate.update(
                    "UPDATE categories SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    name,
                    id);
            return updated == 0 ? Optional.empty() : findCategory(id);
        } catch (DuplicateKeyException exception) {
            throw duplicateNameException();
        }
    }

    public boolean deleteCategory(UUID id) {
        return jdbcTemplate.update("DELETE FROM categories WHERE id = ?", id) > 0;
    }

    public List<CategoryDto> findPostCategories(UUID postId) {
        requirePost(postId);
        return categoriesForPost(postId);
    }

    public List<CategoryDto> setPostCategory(UUID postId, UUID categoryId, boolean assigned) {
        requirePost(postId);
        if (!exists("SELECT EXISTS (SELECT 1 FROM categories WHERE id = ?)", categoryId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Category was not found.");
        }
        if (assigned) {
            jdbcTemplate.update(
                    "INSERT INTO post_categories (post_id, category_id) VALUES (?, ?) "
                            + "ON CONFLICT (post_id, category_id) DO NOTHING",
                    postId,
                    categoryId);
        } else {
            jdbcTemplate.update(
                    "DELETE FROM post_categories WHERE post_id = ? AND category_id = ?",
                    postId,
                    categoryId);
        }
        return categoriesForPost(postId);
    }

    private Optional<CategoryDto> findCategory(UUID id) {
        List<CategoryDto> categories = jdbcTemplate.query(
                "SELECT id, name, created_at, updated_at FROM categories WHERE id = ?",
                CATEGORY_MAPPER,
                id);
        return categories.stream().findFirst();
    }

    private List<CategoryDto> categoriesForPost(UUID postId) {
        return jdbcTemplate.query(
                "SELECT c.id, c.name, c.created_at, c.updated_at "
                        + "FROM categories c JOIN post_categories pc ON pc.category_id = c.id "
                        + "WHERE pc.post_id = ? ORDER BY LOWER(c.name), c.id",
                CATEGORY_MAPPER,
                postId);
    }

    private void requirePost(UUID postId) {
        if (!exists("SELECT EXISTS (SELECT 1 FROM posts WHERE id = ?)", postId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Post was not found.");
        }
    }

    private boolean exists(String query, UUID id) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(query, Boolean.class, id));
    }

    private ResponseStatusException duplicateNameException() {
        return new ResponseStatusException(
                HttpStatus.CONFLICT,
                "A category with this name already exists.");
    }
}
