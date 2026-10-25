package com.reelnest.library;

import java.util.List;

public record PostPageResponse(
        List<PostDto> items,
        int page,
        int size,
        long totalElements,
        long totalPages,
        boolean hasNext,
        boolean hasPrevious) {
}
