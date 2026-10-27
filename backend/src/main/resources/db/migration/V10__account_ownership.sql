CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX accounts_username_case_insensitive_uq
    ON accounts (LOWER(username));

ALTER TABLE posts
    DROP CONSTRAINT posts_source_identifier_key,
    DROP CONSTRAINT posts_canonical_url_key,
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT posts_id_account_id_uq UNIQUE (id, account_id);

CREATE UNIQUE INDEX posts_account_source_identifier_uq
    ON posts (account_id, source_identifier)
    WHERE account_id IS NOT NULL;

CREATE UNIQUE INDEX posts_account_canonical_url_uq
    ON posts (account_id, canonical_url)
    WHERE account_id IS NOT NULL;

ALTER TABLE import_jobs
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

DROP INDEX categories_name_case_insensitive_uq;

ALTER TABLE categories
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT categories_id_account_id_uq UNIQUE (id, account_id);

CREATE UNIQUE INDEX categories_account_name_case_insensitive_uq
    ON categories (account_id, LOWER(name))
    WHERE account_id IS NOT NULL;

DROP INDEX collections_name_case_insensitive_uq;

ALTER TABLE collections
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT collections_id_account_id_uq UNIQUE (id, account_id);

CREATE UNIQUE INDEX collections_account_name_case_insensitive_uq
    ON collections (account_id, LOWER(name))
    WHERE account_id IS NOT NULL;

ALTER TABLE watch_sessions
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT watch_sessions_id_account_id_uq UNIQUE (id, account_id);

ALTER TABLE post_favorites
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT post_favorites_post_account_fk
        FOREIGN KEY (post_id, account_id) REFERENCES posts(id, account_id) ON DELETE CASCADE;

ALTER TABLE post_notes
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT post_notes_post_account_fk
        FOREIGN KEY (post_id, account_id) REFERENCES posts(id, account_id) ON DELETE CASCADE;

ALTER TABLE post_categories
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT post_categories_post_account_fk
        FOREIGN KEY (post_id, account_id) REFERENCES posts(id, account_id) ON DELETE CASCADE,
    ADD CONSTRAINT post_categories_category_account_fk
        FOREIGN KEY (category_id, account_id) REFERENCES categories(id, account_id) ON DELETE CASCADE;

ALTER TABLE collection_posts
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT collection_posts_collection_account_fk
        FOREIGN KEY (collection_id, account_id) REFERENCES collections(id, account_id) ON DELETE CASCADE,
    ADD CONSTRAINT collection_posts_post_account_fk
        FOREIGN KEY (post_id, account_id) REFERENCES posts(id, account_id) ON DELETE CASCADE;

ALTER TABLE post_view_history
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT post_view_history_post_account_fk
        FOREIGN KEY (post_id, account_id) REFERENCES posts(id, account_id) ON DELETE CASCADE;

ALTER TABLE watch_session_posts
    ADD COLUMN account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    ADD CONSTRAINT watch_session_posts_session_account_fk
        FOREIGN KEY (session_id, account_id) REFERENCES watch_sessions(id, account_id) ON DELETE CASCADE,
    ADD CONSTRAINT watch_session_posts_post_account_fk
        FOREIGN KEY (post_id, account_id) REFERENCES posts(id, account_id) ON DELETE CASCADE;

CREATE INDEX posts_account_saved_at_idx
    ON posts (account_id, saved_at DESC, id DESC)
    WHERE account_id IS NOT NULL;

CREATE INDEX import_jobs_account_created_at_idx
    ON import_jobs (account_id, created_at DESC)
    WHERE account_id IS NOT NULL;

CREATE INDEX post_favorites_account_id_idx ON post_favorites (account_id);
CREATE INDEX post_notes_account_id_idx ON post_notes (account_id);
CREATE INDEX post_categories_account_id_idx ON post_categories (account_id);
CREATE INDEX collection_posts_account_id_idx ON collection_posts (account_id);
CREATE INDEX post_view_history_account_id_idx ON post_view_history (account_id);
CREATE INDEX watch_sessions_account_created_at_idx
    ON watch_sessions (account_id, created_at DESC, id DESC)
    WHERE account_id IS NOT NULL;
CREATE INDEX watch_session_posts_account_id_idx ON watch_session_posts (account_id);
