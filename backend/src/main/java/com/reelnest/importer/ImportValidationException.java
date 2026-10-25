package com.reelnest.importer;

import org.springframework.http.HttpStatus;

public class ImportValidationException extends RuntimeException {

    private final HttpStatus status;

    public ImportValidationException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
