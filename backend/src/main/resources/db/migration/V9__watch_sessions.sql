CREATE TABLE watch_sessions (
    id UUID PRIMARY KEY,
    name VARCHAR(80),
    current_position INTEGER NOT NULL DEFAULT 0 CHECK (current_position >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

CREATE TABLE watch_session_posts (
    session_id UUID NOT NULL REFERENCES watch_sessions(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    PRIMARY KEY (session_id, post_id),
    UNIQUE (session_id, sort_order)
);

CREATE INDEX watch_sessions_created_at_idx
    ON watch_sessions (created_at DESC, id DESC);
