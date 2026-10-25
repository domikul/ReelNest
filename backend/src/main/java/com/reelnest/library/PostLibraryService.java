package com.reelnest.library;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class PostLibraryService {

    private static final RowMapper<PostDto> POST_MAPPER = (resultSet, rowNumber) ->
            new PostDto(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("original_url"),
                    resultSet.getTimestamp("saved_at").toInstant(),
                    resultSet.getBoolean("favorite"));

    private final JdbcTemplate jdbcTemplate;

    public PostLibraryService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public PostPageResponse findPosts(int page, int size) {
        long offset = (long) page * size;
        List<PostDto> posts = jdbcTemplate.query(
                "SELECT p.id, p.original_url, p.saved_at, f.post_id IS NOT NULL AS favorite "
                        + "FROM posts p LEFT JOIN post_favorites f ON f.post_id = p.id "
                        + "ORDER BY p.saved_at DESC, p.id DESC LIMIT ? OFFSET ?",
                POST_MAPPER,
                size,
                offset);
        long totalElements = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM posts",
                Long.class);
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

    public Optional<PostDto> findPost(UUID id) {
        List<PostDto> posts = jdbcTemplate.query(
                "SELECT p.id, p.original_url, p.saved_at, f.post_id IS NOT NULL AS favorite "
                        + "FROM posts p LEFT JOIN post_favorites f ON f.post_id = p.id WHERE p.id = ?",
                POST_MAPPER,
                id);
        return posts.stream().findFirst();
    }

    public Optional<PostDto> setFavorite(UUID id, boolean favorite) {
        if (favorite) {
            jdbcTemplate.update(
                    "INSERT INTO post_favorites (post_id) "
                            + "SELECT id FROM posts WHERE id = ? "
                            + "ON CONFLICT (post_id) DO NOTHING",
                    id);
        } else {
            jdbcTemplate.update(
                    "DELETE FROM post_favorites WHERE post_id = ?",
                    id);
        }
        return findPost(id);
    }
}
