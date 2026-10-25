CREATE INDEX posts_source_search_idx
    ON posts USING GIN (to_tsvector('simple', COALESCE(original_url, '') || ' ' || source_metadata::text));

CREATE INDEX post_notes_search_idx
    ON post_notes USING GIN (to_tsvector('simple', note));

CREATE INDEX categories_search_idx
    ON categories USING GIN (to_tsvector('simple', name));
