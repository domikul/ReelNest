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

    public Optional<PostNoteDto> findNote(UUID id) {
        List<PostNoteDto> notes = jdbcTemplate.query(
                "SELECT p.id AS post_id, n.note, n.updated_at "
                        + "FROM posts p LEFT JOIN post_notes n ON n.post_id = p.id WHERE p.id = ?",
                (resultSet, rowNumber) -> {
                    var updatedAt = resultSet.getTimestamp("updated_at");
                    return new PostNoteDto(
                            resultSet.getObject("post_id", UUID.class),
                            resultSet.getString("note"),
                            updatedAt == null ? null : updatedAt.toInstant());
                },
                id);
        return notes.stream().findFirst();
    }

    public Optional<PostNoteDto> saveNote(UUID id, String note) {
        jdbcTemplate.update(
                "INSERT INTO post_notes (post_id, note) "
                        + "SELECT id, ? FROM posts WHERE id = ? "
                        + "ON CONFLICT (post_id) DO UPDATE "
                        + "SET note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP",
                note,
                id);
        return findNote(id);
    }

    public Optional<PostNoteDto> deleteNote(UUID id) {
        jdbcTemplate.update("DELETE FROM post_notes WHERE post_id = ?", id);
        return findNote(id).map(note -> new PostNoteDto(note.postId(), null, null));
    }
}
