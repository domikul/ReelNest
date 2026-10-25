package com.reelnest.collection;

import com.reelnest.library.PostDto;
import com.reelnest.library.PostPageResponse;
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
public class CollectionService {

    private static final RowMapper<CollectionDto> COLLECTION_MAPPER = (resultSet, rowNumber) ->
            new CollectionDto(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("name"),
                    resultSet.getTimestamp("created_at").toInstant(),
                    resultSet.getTimestamp("updated_at").toInstant(),
                    resultSet.getLong("post_count"));

    private static final RowMapper<PostDto> POST_MAPPER = (resultSet, rowNumber) ->
            new PostDto(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("original_url"),
                    resultSet.getTimestamp("saved_at").toInstant(),
                    resultSet.getBoolean("favorite"));

    private final JdbcTemplate jdbcTemplate;

    public CollectionService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<CollectionDto> findCollections() {
        return jdbcTemplate.query(
                "SELECT c.id, c.name, c.created_at, c.updated_at, COUNT(cp.post_id) AS post_count "
                        + "FROM collections c LEFT JOIN collection_posts cp ON cp.collection_id = c.id "
                        + "GROUP BY c.id ORDER BY LOWER(c.name), c.id",
                COLLECTION_MAPPER);
    }

    public CollectionDto createCollection(String name) {
        UUID id = UUID.randomUUID();
        try {
            jdbcTemplate.update("INSERT INTO collections (id, name) VALUES (?, ?)", id, name);
        } catch (DuplicateKeyException exception) {
            throw duplicateNameException();
        }
        return findCollection(id).orElseThrow(() ->
                new IllegalStateException("Created collection could not be loaded."));
    }

    public Optional<CollectionDto> updateCollection(UUID id, String name) {
        try {
            int updated = jdbcTemplate.update(
                    "UPDATE collections SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    name,
                    id);
            return updated == 0 ? Optional.empty() : findCollection(id);
        } catch (DuplicateKeyException exception) {
            throw duplicateNameException();
        }
    }

    public boolean deleteCollection(UUID id) {
        return jdbcTemplate.update("DELETE FROM collections WHERE id = ?", id) > 0;
    }

    public PostPageResponse findPosts(UUID collectionId, int page, int size) {
        requireCollection(collectionId);
        long offset = (long) page * size;
        List<PostDto> posts = jdbcTemplate.query(
                "SELECT p.id, p.original_url, p.saved_at, f.post_id IS NOT NULL AS favorite "
                        + "FROM posts p JOIN collection_posts cp ON cp.post_id = p.id "
                        + "LEFT JOIN post_favorites f ON f.post_id = p.id "
                        + "WHERE cp.collection_id = ? "
                        + "ORDER BY p.saved_at DESC, p.id DESC LIMIT ? OFFSET ?",
                POST_MAPPER,
                collectionId,
                size,
                offset);
        long totalElements = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM collection_posts WHERE collection_id = ?",
                Long.class,
                collectionId);
        long totalPages = totalElements == 0 ? 0 : 1 + (totalElements - 1) / size;

        return new PostPageResponse(
                List.copyOf(posts),
                page,
                size,
                totalElements,
                totalPages,
                (page + 1L) * size < totalElements,
                page > 0);
    }

    public List<CollectionDto> findPostCollections(UUID postId) {
        requirePost(postId);
        return jdbcTemplate.query(
                "SELECT c.id, c.name, c.created_at, c.updated_at, "
                        + "(SELECT COUNT(*) FROM collection_posts all_posts "
                        + "WHERE all_posts.collection_id = c.id) AS post_count "
                        + "FROM collections c JOIN collection_posts cp ON cp.collection_id = c.id "
                        + "WHERE cp.post_id = ? ORDER BY LOWER(c.name), c.id",
                COLLECTION_MAPPER,
                postId);
    }

    public List<CollectionDto> setPostCollection(UUID postId, UUID collectionId, boolean assigned) {
        requirePost(postId);
        requireCollection(collectionId);
        if (assigned) {
            jdbcTemplate.update(
                    "INSERT INTO collection_posts (collection_id, post_id) VALUES (?, ?) "
                            + "ON CONFLICT (collection_id, post_id) DO NOTHING",
                    collectionId,
                    postId);
        } else {
            jdbcTemplate.update(
                    "DELETE FROM collection_posts WHERE collection_id = ? AND post_id = ?",
                    collectionId,
                    postId);
        }
        return findPostCollections(postId);
    }

    private Optional<CollectionDto> findCollection(UUID id) {
        List<CollectionDto> collections = jdbcTemplate.query(
                "SELECT c.id, c.name, c.created_at, c.updated_at, COUNT(cp.post_id) AS post_count "
                        + "FROM collections c LEFT JOIN collection_posts cp ON cp.collection_id = c.id "
                        + "WHERE c.id = ? GROUP BY c.id",
                COLLECTION_MAPPER,
                id);
        return collections.stream().findFirst();
    }

    private void requirePost(UUID postId) {
        if (!exists("SELECT EXISTS (SELECT 1 FROM posts WHERE id = ?)", postId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Post was not found.");
        }
    }

    private void requireCollection(UUID collectionId) {
        if (!exists("SELECT EXISTS (SELECT 1 FROM collections WHERE id = ?)", collectionId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Collection was not found.");
        }
    }

    private boolean exists(String query, UUID id) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(query, Boolean.class, id));
    }

    private ResponseStatusException duplicateNameException() {
        return new ResponseStatusException(
                HttpStatus.CONFLICT,
                "A collection with this name already exists.");
    }
}
