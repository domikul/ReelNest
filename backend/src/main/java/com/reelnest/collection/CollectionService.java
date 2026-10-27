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
                    resultSet.getBoolean("favorite"),
                    resultSet.getString("creator_username"),
                    resultSet.getString("caption"));

    private final JdbcTemplate jdbcTemplate;

    public CollectionService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<CollectionDto> findCollections(UUID accountId) {
        return jdbcTemplate.query(
                "SELECT c.id, c.name, c.created_at, c.updated_at, COUNT(cp.post_id) AS post_count "
                        + "FROM collections c LEFT JOIN collection_posts cp "
                        + "ON cp.collection_id = c.id AND cp.account_id = c.account_id "
                        + "WHERE c.account_id = ? GROUP BY c.id ORDER BY LOWER(c.name), c.id",
                COLLECTION_MAPPER,
                accountId);
    }

    public CollectionDto createCollection(UUID accountId, String name) {
        UUID id = UUID.randomUUID();
        try {
            jdbcTemplate.update("INSERT INTO collections (id, account_id, name) VALUES (?, ?, ?)", id, accountId, name);
        } catch (DuplicateKeyException exception) {
            throw duplicateNameException();
        }
        return findCollection(accountId, id).orElseThrow(() ->
                new IllegalStateException("Created collection could not be loaded."));
    }

    public Optional<CollectionDto> updateCollection(UUID accountId, UUID id, String name) {
        try {
            int updated = jdbcTemplate.update(
                    "UPDATE collections SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_id = ?",
                    name,
                    id,
                    accountId);
            return updated == 0 ? Optional.empty() : findCollection(accountId, id);
        } catch (DuplicateKeyException exception) {
            throw duplicateNameException();
        }
    }

    public boolean deleteCollection(UUID accountId, UUID id) {
        return jdbcTemplate.update("DELETE FROM collections WHERE id = ? AND account_id = ?", id, accountId) > 0;
    }

    public PostPageResponse findPosts(UUID accountId, UUID collectionId, int page, int size) {
        requireCollection(accountId, collectionId);
        long offset = (long) page * size;
        List<PostDto> posts = jdbcTemplate.query(
                "SELECT p.id, p.original_url, p.saved_at, f.post_id IS NOT NULL AS favorite, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'creatorUsername' END AS creator_username, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'caption' END AS caption "
                        + "FROM posts p JOIN collection_posts cp ON cp.post_id = p.id AND cp.account_id = p.account_id "
                        + "LEFT JOIN post_favorites f ON f.post_id = p.id AND f.account_id = p.account_id "
                        + "WHERE cp.collection_id = ? AND cp.account_id = ? "
                        + "ORDER BY p.saved_at DESC, p.id DESC LIMIT ? OFFSET ?",
                POST_MAPPER,
                collectionId,
                accountId,
                size,
                offset);
        long totalElements = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM collection_posts WHERE collection_id = ? AND account_id = ?",
                Long.class,
                collectionId,
                accountId);
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

    public List<CollectionDto> findPostCollections(UUID accountId, UUID postId) {
        requirePost(accountId, postId);
        return jdbcTemplate.query(
                "SELECT c.id, c.name, c.created_at, c.updated_at, "
                        + "(SELECT COUNT(*) FROM collection_posts all_posts "
                        + "WHERE all_posts.collection_id = c.id AND all_posts.account_id = c.account_id) AS post_count "
                        + "FROM collections c JOIN collection_posts cp ON cp.collection_id = c.id "
                        + "AND cp.account_id = c.account_id "
                        + "WHERE cp.post_id = ? AND cp.account_id = ? ORDER BY LOWER(c.name), c.id",
                COLLECTION_MAPPER,
                postId,
                accountId);
    }

    public List<CollectionDto> setPostCollection(UUID accountId, UUID postId, UUID collectionId, boolean assigned) {
        requirePost(accountId, postId);
        requireCollection(accountId, collectionId);
        if (assigned) {
            jdbcTemplate.update(
                    "INSERT INTO collection_posts (collection_id, post_id, account_id) VALUES (?, ?, ?) "
                            + "ON CONFLICT (collection_id, post_id) DO NOTHING",
                    collectionId,
                    postId,
                    accountId);
        } else {
            jdbcTemplate.update(
                    "DELETE FROM collection_posts WHERE collection_id = ? AND post_id = ? AND account_id = ?",
                    collectionId,
                    postId,
                    accountId);
        }
        return findPostCollections(accountId, postId);
    }

    private Optional<CollectionDto> findCollection(UUID accountId, UUID id) {
        List<CollectionDto> collections = jdbcTemplate.query(
                "SELECT c.id, c.name, c.created_at, c.updated_at, COUNT(cp.post_id) AS post_count "
                        + "FROM collections c LEFT JOIN collection_posts cp "
                        + "ON cp.collection_id = c.id AND cp.account_id = c.account_id "
                        + "WHERE c.id = ? AND c.account_id = ? GROUP BY c.id",
                COLLECTION_MAPPER,
                id,
                accountId);
        return collections.stream().findFirst();
    }

    private void requirePost(UUID accountId, UUID postId) {
        if (!exists("SELECT EXISTS (SELECT 1 FROM posts WHERE id = ? AND account_id = ?)", postId, accountId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Post was not found.");
        }
    }

    private void requireCollection(UUID accountId, UUID collectionId) {
        if (!exists("SELECT EXISTS (SELECT 1 FROM collections WHERE id = ? AND account_id = ?)", collectionId, accountId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Collection was not found.");
        }
    }

    private boolean exists(String query, UUID id, UUID accountId) {
        return Boolean.TRUE.equals(jdbcTemplate.queryForObject(query, Boolean.class, id, accountId));
    }

    private ResponseStatusException duplicateNameException() {
        return new ResponseStatusException(
                HttpStatus.CONFLICT,
                "A collection with this name already exists.");
    }
}
