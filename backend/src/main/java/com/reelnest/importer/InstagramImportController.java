package com.reelnest.importer;

import com.reelnest.security.AccountPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.UUID;

@RestController
@RequestMapping("/api/imports")
public class InstagramImportController {

    private final InstagramImportService importService;

    public InstagramImportController(InstagramImportService importService) {
        this.importService = importService;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ImportSummary> importSavedPosts(
            @AuthenticationPrincipal AccountPrincipal account,
            @RequestPart("file") MultipartFile file,
            @RequestParam(required = false) String timeZone) {
        if (file.isEmpty()) {
            throw new ImportValidationException(HttpStatus.BAD_REQUEST, "Upload must not be empty.");
        }

        ZoneId zoneId = resolveTimeZone(timeZone);
        try {
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(importService.importSavedPosts(account.accountId(), file.getBytes(), zoneId));
        } catch (IOException exception) {
            throw new ImportValidationException(HttpStatus.BAD_REQUEST, "Upload could not be read.");
        }
    }

    @GetMapping("/{importId}")
    public ImportSummary getImport(@AuthenticationPrincipal AccountPrincipal account, @PathVariable UUID importId) {
        return importService.findImport(account.accountId(), importId)
                .orElseThrow(() -> new ImportValidationException(HttpStatus.NOT_FOUND, "Import job was not found."));
    }

    private ZoneId resolveTimeZone(String timeZone) {
        if (timeZone == null || timeZone.isBlank()) {
            return ZoneId.systemDefault();
        }
        try {
            return ZoneId.of(timeZone);
        } catch (DateTimeException exception) {
            throw new ImportValidationException(HttpStatus.BAD_REQUEST, "Time zone is invalid.");
        }
    }
}
