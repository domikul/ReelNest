package com.reelnest.importer;

public record ImportItemError(int recordIndex, String code, String message) {
}
