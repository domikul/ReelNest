package com.reelnest.watchsession;

import com.reelnest.library.PostDto;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class WatchSessionService {

    private static final int MAX_SESSION_POSTS = 100;
    private static final int MAX_SESSION_LIST_SIZE = 50;

    private static final RowMapper<WatchSessionSummaryDto> SUMMARY_MAPPER = (resultSet, rowNumber) ->
            new WatchSessionSummaryDto(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("name"),
                    resultSet.getTimestamp("created_at").toInstant(),
                    Optional.ofNullable(resultSet.getTimestamp("completed_at"))
                            .map(Timestamp::toInstant)
                            .orElse(null),
                    resultSet.getInt("post_count"),
                    resultSet.getInt("current_position"));

    private static final RowMapper<PostDto> POST_MAPPER = (resultSet, rowNumber) ->
            new PostDto(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("original_url"),
                    resultSet.getTimestamp("saved_at").toInstant(),
                    resultSet.getBoolean("favorite"),
                    resultSet.getString("creator_username"),
                    resultSet.getString("caption"));

    private final JdbcTemplate jdbcTemplate;

    public WatchSessionService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<WatchSessionSummaryDto> findSessions() {
        return List.copyOf(jdbcTemplate.query(
                "SELECT s.id, s.name, s.created_at, s.completed_at, "
                        + "LEAST(s.current_position, COUNT(sp.post_id)) AS current_position, "
                        + "COUNT(sp.post_id) AS post_count "
                        + "FROM watch_sessions s "
                        + "JOIN watch_session_posts sp ON sp.session_id = s.id "
                        + "GROUP BY s.id "
                        + "ORDER BY s.created_at DESC, s.id DESC LIMIT ?",
                SUMMARY_MAPPER,
                MAX_SESSION_LIST_SIZE));
    }

    public Optional<WatchSessionDto> findSession(UUID sessionId) {
        List<WatchSessionSummaryDto> summaries = jdbcTemplate.query(
                "SELECT s.id, s.name, s.created_at, s.completed_at, s.current_position, "
                        + "(SELECT COUNT(*) FROM watch_session_posts sp WHERE sp.session_id = s.id) AS post_count "
                        + "FROM watch_sessions s WHERE s.id = ?",
                SUMMARY_MAPPER,
                sessionId);
        if (summaries.isEmpty()) {
            return Optional.empty();
        }

        WatchSessionSummaryDto summary = summaries.getFirst();
        List<PostDto> posts = jdbcTemplate.query(
                "SELECT p.id, p.original_url, p.saved_at, f.post_id IS NOT NULL AS favorite, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'creatorUsername' END AS creator_username, "
                        + "CASE WHEN jsonb_typeof(p.source_metadata) = 'object' "
                        + "THEN p.source_metadata ->> 'caption' END AS caption "
                        + "FROM watch_session_posts sp "
                        + "JOIN posts p ON p.id = sp.post_id "
                        + "LEFT JOIN post_favorites f ON f.post_id = p.id "
                        + "WHERE sp.session_id = ? ORDER BY sp.sort_order",
                POST_MAPPER,
                sessionId);
        return Optional.of(new WatchSessionDto(
                summary.id(),
                summary.name(),
                summary.createdAt(),
                summary.completedAt(),
                posts.size(),
                Math.min(summary.currentPosition(), posts.size()),
                List.copyOf(posts)));
    }

    @Transactional
    public WatchSessionDto createSession(String name, List<UUID> postIds) {
        if (postIds == null || postIds.isEmpty() || postIds.size() > MAX_SESSION_POSTS) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "A watch session must contain between 1 and " + MAX_SESSION_POSTS + " posts.");
        }
        if (postIds.stream().distinct().count() != postIds.size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A post cannot appear more than once.");
        }

        String postPlaceholders = postIds.stream().map(ignored -> "?").collect(Collectors.joining(", "));
        long matchingPosts = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM posts WHERE id IN (" + postPlaceholders + ")",
                Long.class,
                postIds.toArray());
        if (matchingPosts != postIds.size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Every selected post must be saved in the library.");
        }

        UUID sessionId = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO watch_sessions (id, name) VALUES (?, ?)",
                sessionId,
                name);
        for (int position = 0; position < postIds.size(); position++) {
            jdbcTemplate.update(
                    "INSERT INTO watch_session_posts (session_id, post_id, sort_order) VALUES (?, ?, ?)",
                    sessionId,
                    postIds.get(position),
                    position);
        }
        return findSession(sessionId).orElseThrow(() ->
                new IllegalStateException("Created watch session could not be loaded."));
    }

    @Transactional
    public Optional<WatchSessionDto> updateProgress(UUID sessionId, int currentPosition) {
        boolean sessionExists = Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM watch_sessions WHERE id = ?)",
                Boolean.class,
                sessionId));
        if (!sessionExists) {
            return Optional.empty();
        }
        Integer postCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM watch_session_posts WHERE session_id = ?",
                Integer.class,
                sessionId);
        if (currentPosition < 0 || currentPosition > postCount) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Session position must be between 0 and " + postCount + ".");
        }
        jdbcTemplate.update(
                "UPDATE watch_sessions SET current_position = ?, "
                        + "completed_at = CASE WHEN ? = ? THEN CURRENT_TIMESTAMP ELSE NULL END "
                        + "WHERE id = ?",
                currentPosition,
                currentPosition,
                postCount,
                sessionId);
        return findSession(sessionId);
    }
}
