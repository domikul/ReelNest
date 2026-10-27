package com.reelnest.collection;

import com.reelnest.library.PostPageResponse;
import com.reelnest.security.AccountPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
public class CollectionController {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_NAME_LENGTH = 80;

    private final CollectionService collectionService;

    public CollectionController(CollectionService collectionService) {
        this.collectionService = collectionService;
    }

    @GetMapping("/api/collections")
    public List<CollectionDto> listCollections(@AuthenticationPrincipal AccountPrincipal account) {
        return collectionService.findCollections(account.accountId());
    }

    @PostMapping("/api/collections")
    public ResponseEntity<CollectionDto> createCollection(
            @AuthenticationPrincipal AccountPrincipal account,
            @RequestBody CollectionRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(collectionService.createCollection(account.accountId(), validateName(request)));
    }

    @PutMapping("/api/collections/{collectionId}")
    public ResponseEntity<CollectionDto> updateCollection(
            @AuthenticationPrincipal AccountPrincipal account,
            @PathVariable UUID collectionId,
            @RequestBody CollectionRequest request) {
        return collectionService.updateCollection(account.accountId(), collectionId, validateName(request))
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/api/collections/{collectionId}")
    public ResponseEntity<Void> deleteCollection(
            @AuthenticationPrincipal AccountPrincipal account,
            @PathVariable UUID collectionId) {
        return collectionService.deleteCollection(account.accountId(), collectionId)
                ? ResponseEntity.noContent().build()
                : ResponseEntity.notFound().build();
    }

    @GetMapping("/api/collections/{collectionId}/posts")
    public PostPageResponse listCollectionPosts(
            @AuthenticationPrincipal AccountPrincipal account,
            @PathVariable UUID collectionId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        validatePagination(page, size);
        return collectionService.findPosts(account.accountId(), collectionId, page, size);
    }

    @GetMapping("/api/posts/{postId}/collections")
    public List<CollectionDto> listPostCollections(
            @AuthenticationPrincipal AccountPrincipal account,
            @PathVariable UUID postId) {
        return collectionService.findPostCollections(account.accountId(), postId);
    }

    @PutMapping("/api/posts/{postId}/collections/{collectionId}")
    public List<CollectionDto> addPostToCollection(
            @AuthenticationPrincipal AccountPrincipal account,
            @PathVariable UUID postId,
            @PathVariable UUID collectionId) {
        return collectionService.setPostCollection(account.accountId(), postId, collectionId, true);
    }

    @DeleteMapping("/api/posts/{postId}/collections/{collectionId}")
    public List<CollectionDto> removePostFromCollection(
            @AuthenticationPrincipal AccountPrincipal account,
            @PathVariable UUID postId,
            @PathVariable UUID collectionId) {
        return collectionService.setPostCollection(account.accountId(), postId, collectionId, false);
    }

    private void validatePagination(int page, int size) {
        if (page < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Page must be zero or greater.");
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Page size must be between 1 and " + MAX_PAGE_SIZE + ".");
        }
    }

    private String validateName(CollectionRequest request) {
        if (request == null || request.name() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Collection name is required.");
        }
        String name = request.name().strip();
        if (name.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Collection name cannot be blank.");
        }
        if (name.length() > MAX_NAME_LENGTH) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Collection name must be no longer than " + MAX_NAME_LENGTH + " characters.");
        }
        return name;
    }

    public record CollectionRequest(String name) {
    }
}
