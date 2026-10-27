package com.reelnest.watchsession;

import com.reelnest.library.PostDto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record WatchSessionDto(
        UUID id,
        String name,
        Instant createdAt,
        Instant completedAt,
        int postCount,
        int currentPosition,
        List<PostDto> posts) {
}
