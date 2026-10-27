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

    public List<CategoryDto> findCategories(UUID accountId) {
        return jdbcTemplate.query(
                "SELECT id, name, created_at, updated_at FROM categories WHERE account_id = ? ORDER BY LOWER(name), id",
                CATEGORY_MAPPER,
                accountId);
    }

    public CategoryDto createCategory(UUID accountId, String name) {
        UUID id = UUID.randomUUID();
        try {
            jdbcTemplate.update("INSERT INTO categories (id, account_id, name) VALUES (?, ?, ?)", id, accountId, name);
        } catch (DuplicateKeyException exception) {
            throw duplicateNameException();
        }
        return findCategory(accountId, id).orElseThrow(() ->
                new IllegalStateException("Created category could not be loaded."));
    }

    public Optional<CategoryDto> updateCategory(UUID accountId, UUID id, String name) {
        try {
            int updated = jdbcTemplate.update(
                    "UPDATE categories SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_id = ?",
                    name,
                    id,
                    accountId);
            return updated == 0 ? Optional.empty() : findCategory(accountId, id);
        } catch (DuplicateKeyException exception) {
            throw duplicateNameException();
        }
    }

    public boolean deleteCategory(UUID accountId, UUID id) {
        return jdbcTemplate.update("DELETE FROM categories WHERE id = ? AND account_id = ?", id, accountId) > 0;
    }

    public List<CategoryDto> findPostCategories(UUID accountId, UUID postId) {
        requirePost(accountId, postId);
        return categoriesForPost(accountId, postId);
    }

    public List<CategoryDto> setPostCategory(UUID accountId, UUID postId, UUID categoryId, boolean assigned) {
        requirePost(accountId, postId);
        if (!exists("SELECT EXISTS (SELECT 1 FROM categories WHERE id = ? AND account_id = ?)", categoryId, accountId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Category was not found.");
        }
        if (assigned) {
            jdbcTemplate.update(
                    "INSERT INTO post_categories (post_id, category_id, account_id) VALUES (?, ?, ?) "
                            + "ON CONFLICT (post_id, category_id) DO NOTHING",
                    postId,
                    categoryId,
                    accountId);
        } else {
            jdbcTemplate.update(
                    "DELETE FROM post_categories WHERE post_id = ? AND category_id = ? AND account_id = ?",
                    postId,
                    categoryId,
                    accountId);
        }
        return categoriesForPost(accountId, postId);
    }

    private Optional<CategoryDto> findCategory(UUID accountId, UUID id) {
        List<CategoryDto> categories = jdbcTemplate.query(
                "SELECT id, name, created_at, updated_at FROM categories WHERE id = ? AND account_id = ?",
                CATEGORY_MAPPER,
                id,
                accountId);
        return categories.stream().findFirst();
    }

    private List<CategoryDto> categoriesForPost(UUID accountId, UUID postId) {
        return jdbcTemplate.query(
                "SELECT c.id, c.name, c.created_at, c.updated_at "
                        + "FROM categories c JOIN post_categories pc "
                        + "ON pc.category_id = c.id AND pc.account_id = c.account_id "
                        + "WHERE pc.post_id = ? AND pc.account_id = ? ORDER BY LOWER(c.name), c.id",
                CATEGORY_MAPPER,
                postId,
                accountId);
    }

    private void requirePost(UUID accountId, UUID postId) {
        if (!exists("SELECT EXISTS (SELECT 1 FROM posts WHERE id = ? AND account_id = ?)", postId, accountId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Post was not found.");
        }
    }

    private boolean exists(String query, UUID id, UUID accountId) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(query, Boolean.class, id, accountId));
    }

    private ResponseStatusException duplicateNameException() {
        return new ResponseStatusException(
                HttpStatus.CONFLICT,
                "A category with this name already exists.");
    }
}
