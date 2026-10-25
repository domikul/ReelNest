package com.reelnest.importer;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.UUID;

@RestController
@RequestMapping("/api/imports")
public class InstagramImportController {

    private final InstagramImportService importService;

    public InstagramImportController(InstagramImportService importService) {
        this.importService = importService;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ImportSummary> importSavedPosts(@RequestPart("file") MultipartFile file) {
        if (file.isEmpty()) {
            throw new ImportValidationException(HttpStatus.BAD_REQUEST, "Upload must not be empty.");
        }

        try {
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(importService.importSavedPosts(file.getBytes()));
        } catch (IOException exception) {
            throw new ImportValidationException(HttpStatus.BAD_REQUEST, "Upload could not be read.");
        }
    }

    @GetMapping("/{importId}")
    public ImportSummary getImport(@PathVariable UUID importId) {
        return importService.findImport(importId)
                .orElseThrow(() -> new ImportValidationException(HttpStatus.NOT_FOUND, "Import job was not found."));
    }
}
