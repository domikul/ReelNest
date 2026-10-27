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

    public List<WatchSessionSummaryDto> findSessions(UUID accountId) {
        return List.copyOf(jdbcTemplate.query(
                "SELECT s.id, s.name, s.created_at, s.completed_at, "
                        + "LEAST(s.current_position, COUNT(sp.post_id)) AS current_position, "
                        + "COUNT(sp.post_id) AS post_count "
                        + "FROM watch_sessions s "
                        + "JOIN watch_session_posts sp ON sp.session_id = s.id AND sp.account_id = s.account_id "
                        + "WHERE s.account_id = ? GROUP BY s.id "
                        + "ORDER BY s.created_at DESC, s.id DESC LIMIT ?",
                SUMMARY_MAPPER,
                accountId,
                MAX_SESSION_LIST_SIZE));
    }

    public Optional<WatchSessionDto> findSession(UUID accountId, UUID sessionId) {
        List<WatchSessionSummaryDto> summaries = jdbcTemplate.query(
                "SELECT s.id, s.name, s.created_at, s.completed_at, s.current_position, "
                        + "(SELECT COUNT(*) FROM watch_session_posts sp WHERE sp.session_id = s.id "
                        + "AND sp.account_id = s.account_id) AS post_count "
                        + "FROM watch_sessions s WHERE s.id = ? AND s.account_id = ?",
                SUMMARY_MAPPER,
                sessionId,
                accountId);
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
                        + "JOIN posts p ON p.id = sp.post_id AND p.account_id = sp.account_id "
                        + "LEFT JOIN post_favorites f ON f.post_id = p.id AND f.account_id = p.account_id "
                        + "WHERE sp.session_id = ? AND sp.account_id = ? ORDER BY sp.sort_order",
                POST_MAPPER,
                sessionId,
                accountId);
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
    public WatchSessionDto createSession(UUID accountId, String name, List<UUID> postIds) {
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
                "SELECT COUNT(*) FROM posts WHERE account_id = ? AND id IN (" + postPlaceholders + ")",
                Long.class,
                createPostQueryParameters(accountId, postIds));
        if (matchingPosts != postIds.size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Every selected post must be saved in the library.");
        }

        UUID sessionId = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO watch_sessions (id, account_id, name) VALUES (?, ?, ?)",
                sessionId,
                accountId,
                name);
        for (int position = 0; position < postIds.size(); position++) {
            jdbcTemplate.update(
                    "INSERT INTO watch_session_posts (session_id, post_id, sort_order, account_id) VALUES (?, ?, ?, ?)",
                    sessionId,
                    postIds.get(position),
                    position,
                    accountId);
        }
        return findSession(accountId, sessionId).orElseThrow(() ->
                new IllegalStateException("Created watch session could not be loaded."));
    }

    @Transactional
    public Optional<WatchSessionDto> updateProgress(UUID accountId, UUID sessionId, int currentPosition) {
        boolean sessionExists = Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM watch_sessions WHERE id = ? AND account_id = ?)",
                Boolean.class,
                sessionId,
                accountId));
        if (!sessionExists) {
            return Optional.empty();
        }
        Integer postCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM watch_session_posts WHERE session_id = ? AND account_id = ?",
                Integer.class,
                sessionId,
                accountId);
        if (currentPosition < 0 || currentPosition > postCount) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Session position must be between 0 and " + postCount + ".");
        }
        jdbcTemplate.update(
                "UPDATE watch_sessions SET current_position = ?, "
                        + "completed_at = CASE WHEN ? = ? THEN CURRENT_TIMESTAMP ELSE NULL END "
                        + "WHERE id = ? AND account_id = ?",
                currentPosition,
                currentPosition,
                postCount,
                sessionId,
                accountId);
        return findSession(accountId, sessionId);
    }

    private Object[] createPostQueryParameters(UUID accountId, List<UUID> postIds) {
        Object[] parameters = new Object[postIds.size() + 1];
        parameters[0] = accountId;
        for (int index = 0; index < postIds.size(); index++) {
            parameters[index + 1] = postIds.get(index);
        }
        return parameters;
    }
}
