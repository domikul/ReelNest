CREATE TABLE post_view_history (
    post_id UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
    last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX post_view_history_last_viewed_idx
    ON post_view_history (last_viewed_at DESC, post_id DESC);
