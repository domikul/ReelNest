package com.reelnest.library;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
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
                    resultSet.getBoolean("favorite"),
                    resultSet.getString("creator_username"),
                    resultSet.getString("caption"));

    private final JdbcTemplate jdbcTemplate;

    public PostLibraryService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public PostPageResponse findPosts(
            int page,
            int size,
            String query,
            Boolean favorite,
            UUID categoryId,
            UUID collectionId) {
        FilterClause filter = buildFilter(query, favorite, categoryId, collectionId);
        long offset = (long) page * size;
        List<Object> pageParameters = new ArrayList<>(filter.parameters());
        pageParameters.add(size);
        pageParameters.add(offset);
        List<PostDto> posts = jdbcTemplate.query(
                "SELECT p.id, p.original_url, p.saved_at, f.post_id IS NOT NULL AS favorite, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'creatorUsername' END AS creator_username, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'caption' END AS caption "
                        + "FROM posts p LEFT JOIN post_favorites f ON f.post_id = p.id "
                        + filter.whereClause()
                        + " ORDER BY p.saved_at DESC, p.id DESC LIMIT ? OFFSET ?",
                POST_MAPPER,
                pageParameters.toArray());
        long totalElements = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM posts p" + filter.whereClause(),
                Long.class,
                filter.parameters().toArray());
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

    private FilterClause buildFilter(
            String query,
            Boolean favorite,
            UUID categoryId,
            UUID collectionId) {
        StringBuilder where = new StringBuilder(" WHERE 1 = 1");
        List<Object> parameters = new ArrayList<>();
        if (query != null) {
            where.append(" AND (to_tsvector('simple', COALESCE(p.original_url, '') || ' ' "
                    + "|| p.source_metadata::text) @@ websearch_to_tsquery('simple', ?) "
                    + "OR EXISTS (SELECT 1 FROM post_notes n WHERE n.post_id = p.id "
                    + "AND to_tsvector('simple', n.note) @@ websearch_to_tsquery('simple', ?)) "
                    + "OR EXISTS (SELECT 1 FROM post_categories pc "
                    + "JOIN categories c ON c.id = pc.category_id "
                    + "WHERE pc.post_id = p.id "
                    + "AND to_tsvector('simple', c.name) @@ websearch_to_tsquery('simple', ?)))");
            parameters.add(query);
            parameters.add(query);
            parameters.add(query);
        }
        if (favorite != null) {
            where.append(favorite
                    ? " AND EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id)"
                    : " AND NOT EXISTS (SELECT 1 FROM post_favorites f WHERE f.post_id = p.id)");
        }
        if (categoryId != null) {
            where.append(" AND EXISTS (SELECT 1 FROM post_categories pc "
                    + "WHERE pc.post_id = p.id AND pc.category_id = ?)");
            parameters.add(categoryId);
        }
        if (collectionId != null) {
            where.append(" AND EXISTS (SELECT 1 FROM collection_posts cp "
                    + "WHERE cp.post_id = p.id AND cp.collection_id = ?)");
            parameters.add(collectionId);
        }
        return new FilterClause(where.toString(), List.copyOf(parameters));
    }

    public Optional<PostDto> findPost(UUID id) {
        List<PostDto> posts = jdbcTemplate.query(
                "SELECT p.id, p.original_url, p.saved_at, f.post_id IS NOT NULL AS favorite, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'creatorUsername' END AS creator_username, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'caption' END AS caption "
                        + "FROM posts p LEFT JOIN post_favorites f ON f.post_id = p.id WHERE p.id = ?",
                POST_MAPPER,
                id);
        return posts.stream().findFirst();
    }

    public boolean recordView(UUID id) {
        return jdbcTemplate.update(
                "INSERT INTO post_view_history (post_id) "
                        + "SELECT id FROM posts WHERE id = ? "
                        + "ON CONFLICT (post_id) DO UPDATE "
                        + "SET last_viewed_at = GREATEST("
                        + "post_view_history.last_viewed_at, EXCLUDED.last_viewed_at)",
                id) > 0;
    }

    public List<RecentlyWatchedPostDto> findRecentlyWatched(int size) {
        return List.copyOf(jdbcTemplate.query(
                "SELECT p.id, p.original_url, p.saved_at, "
                        + "f.post_id IS NOT NULL AS favorite, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'creatorUsername' END AS creator_username, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'caption' END AS caption, v.last_viewed_at "
                        + "FROM post_view_history v "
                        + "JOIN posts p ON p.id = v.post_id "
                        + "LEFT JOIN post_favorites f ON f.post_id = p.id "
                        + "ORDER BY v.last_viewed_at DESC, p.id DESC LIMIT ?",
                (resultSet, rowNumber) -> new RecentlyWatchedPostDto(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("original_url"),
                        resultSet.getTimestamp("saved_at").toInstant(),
                        resultSet.getBoolean("favorite"),
                        resultSet.getString("creator_username"),
                        resultSet.getString("caption"),
                        resultSet.getTimestamp("last_viewed_at").toInstant()),
                size));
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

    private record FilterClause(String whereClause, List<Object> parameters) {
    }
}
