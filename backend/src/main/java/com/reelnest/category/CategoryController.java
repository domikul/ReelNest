package com.reelnest.category;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@RestController
public class CategoryController {

    private static final int MAX_NAME_LENGTH = 80;

    private final CategoryService categoryService;

    public CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @GetMapping("/api/categories")
    public List<CategoryDto> listCategories() {
        return categoryService.findCategories();
    }

    @PostMapping("/api/categories")
    public ResponseEntity<CategoryDto> createCategory(@RequestBody CategoryRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(categoryService.createCategory(validateName(request)));
    }

    @PutMapping("/api/categories/{categoryId}")
    public ResponseEntity<CategoryDto> updateCategory(
            @PathVariable UUID categoryId,
            @RequestBody CategoryRequest request) {
        return categoryService.updateCategory(categoryId, validateName(request))
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/api/categories/{categoryId}")
    public ResponseEntity<Void> deleteCategory(@PathVariable UUID categoryId) {
        return categoryService.deleteCategory(categoryId)
                ? ResponseEntity.noContent().build()
                : ResponseEntity.notFound().build();
    }

    @GetMapping("/api/posts/{postId}/categories")
    public List<CategoryDto> listPostCategories(@PathVariable UUID postId) {
        return categoryService.findPostCategories(postId);
    }

    @PutMapping("/api/posts/{postId}/categories/{categoryId}")
    public List<CategoryDto> assignCategory(
            @PathVariable UUID postId,
            @PathVariable UUID categoryId) {
        return categoryService.setPostCategory(postId, categoryId, true);
    }

    @DeleteMapping("/api/posts/{postId}/categories/{categoryId}")
    public List<CategoryDto> removeCategory(
            @PathVariable UUID postId,
            @PathVariable UUID categoryId) {
        return categoryService.setPostCategory(postId, categoryId, false);
    }

    private String validateName(CategoryRequest request) {
        if (request == null || request.name() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Category name is required.");
        }
        String name = request.name().strip();
        if (name.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Category name cannot be blank.");
        }
        if (name.length() > MAX_NAME_LENGTH) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Category name must be no longer than " + MAX_NAME_LENGTH + " characters.");
        }
        return name;
    }

    public record CategoryRequest(String name) {
    }
}
