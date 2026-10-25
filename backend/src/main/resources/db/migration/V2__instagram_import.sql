CREATE TABLE posts (
    id UUID PRIMARY KEY,
    source_identifier TEXT NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    canonical_url TEXT NOT NULL UNIQUE,
    saved_at TIMESTAMPTZ NOT NULL,
    source_metadata JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_jobs (
    id UUID PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'COMPLETED_WITH_ERRORS')),
    added_count INTEGER NOT NULL CHECK (added_count >= 0),
    updated_count INTEGER NOT NULL CHECK (updated_count >= 0),
    skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
    error_count INTEGER NOT NULL CHECK (error_count >= 0),
    errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX posts_saved_at_idx ON posts (saved_at DESC);
CREATE INDEX import_jobs_created_at_idx ON import_jobs (created_at DESC);
