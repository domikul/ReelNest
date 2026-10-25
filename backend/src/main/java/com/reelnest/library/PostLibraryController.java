package com.reelnest.library;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@RestController
@RequestMapping("/api/posts")
public class PostLibraryController {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_NOTE_LENGTH = 5000;

    private final PostLibraryService postLibraryService;

    public PostLibraryController(PostLibraryService postLibraryService) {
        this.postLibraryService = postLibraryService;
    }

    @GetMapping
    public PostPageResponse listPosts(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        if (page < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Page must be zero or greater.");
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Page size must be between 1 and " + MAX_PAGE_SIZE + ".");
        }
        return postLibraryService.findPosts(page, size);
    }

    @GetMapping("/{postId}")
    public ResponseEntity<PostDto> getPost(@PathVariable UUID postId) {
        return postLibraryService.findPost(postId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/{postId}/favorite")
    public ResponseEntity<PostDto> setFavorite(
            @PathVariable UUID postId,
            @RequestBody FavoriteRequest request) {
        if (request == null || request.favorite() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Favorite must be true or false.");
        }
        return postLibraryService.setFavorite(postId, request.favorite())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/{postId}/notes")
    public ResponseEntity<PostNoteDto> getNote(@PathVariable UUID postId) {
        return postLibraryService.findNote(postId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/{postId}/notes")
    public ResponseEntity<PostNoteDto> saveNote(
            @PathVariable UUID postId,
            @RequestBody NoteRequest request) {
        if (request == null || request.note() == null || request.note().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Note must contain non-whitespace text.");
        }
        if (request.note().length() > MAX_NOTE_LENGTH) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Note must be no longer than " + MAX_NOTE_LENGTH + " characters.");
        }
        return postLibraryService.saveNote(postId, request.note())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{postId}/notes")
    public ResponseEntity<Void> deleteNote(@PathVariable UUID postId) {
        return postLibraryService.deleteNote(postId)
                .map(ignored -> ResponseEntity.noContent().<Void>build())
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    public record FavoriteRequest(Boolean favorite) {
    }

    public record NoteRequest(String note) {
    }
}
