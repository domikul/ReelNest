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
                    resultSet.getTimestamp("saved_at").toInstant());

    private final JdbcTemplate jdbcTemplate;

    public PostLibraryService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public PostPageResponse findPosts(int page, int size) {
        long offset = (long) page * size;
        List<PostDto> posts = jdbcTemplate.query(
                "SELECT id, original_url, saved_at FROM posts "
                        + "ORDER BY saved_at DESC, id DESC LIMIT ? OFFSET ?",
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
                "SELECT id, original_url, saved_at FROM posts WHERE id = ?",
                POST_MAPPER,
                id);
        return posts.stream().findFirst();
    }
}
