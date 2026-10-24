-- Stores media requests received from Seerr (Overseerr / Jellyseerr) via webhook.
-- When a request is approved in Seerr, Feedarr stores it here and watches for
-- matching torrent releases arriving via subsequent RSS syncs.
CREATE TABLE IF NOT EXISTS seerr_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Seerr-side identifiers
    seerr_request_id INTEGER,              -- Seerr internal request id (nullable on first webhook)
    seerr_app_id     INTEGER,              -- foreign key → arr_apps.id (which Seerr instance)
    -- Media metadata
    media_type       TEXT NOT NULL,        -- 'movie' | 'tv'
    tmdb_id          INTEGER,
    tvdb_id          INTEGER,
    imdb_id          TEXT,
    title            TEXT NOT NULL,
    year             INTEGER,
    -- Seerr event info
    notification_type TEXT NOT NULL,       -- 'MEDIA_APPROVED' | 'MEDIA_AVAILABLE' | 'MEDIA_DECLINED'
    requested_by      TEXT,               -- username
    -- Match tracking
    matched_release_id INTEGER,            -- releases.id if a matching torrent was found
    matched_at_ts      INTEGER,            -- unix timestamp when matched
    -- Timestamps
    received_at_ts   INTEGER NOT NULL,
    updated_at_ts    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seerr_requests_tmdb
    ON seerr_requests(tmdb_id) WHERE tmdb_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seerr_requests_tvdb
    ON seerr_requests(tvdb_id) WHERE tvdb_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seerr_requests_unmatched
    ON seerr_requests(matched_release_id, notification_type, media_type)
    WHERE matched_release_id IS NULL;
