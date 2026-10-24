-- Hungarian localised metadata fields (TMDB hu-HU with en-US fallback)
ALTER TABLE releases ADD COLUMN ext_title_hu      TEXT;
ALTER TABLE releases ADD COLUMN ext_overview_hu   TEXT;
ALTER TABLE releases ADD COLUMN ext_title_original TEXT;

-- Ratings from OMDb (IMDb + Rotten Tomatoes + Metascore)
ALTER TABLE releases ADD COLUMN ext_imdb_id      TEXT;
ALTER TABLE releases ADD COLUMN ext_imdb_score   REAL;
ALTER TABLE releases ADD COLUMN ext_imdb_votes   INTEGER;
ALTER TABLE releases ADD COLUMN ext_rt_score     INTEGER;
ALTER TABLE releases ADD COLUMN ext_metascore    INTEGER;
ALTER TABLE releases ADD COLUMN ext_ratings_fetched_at INTEGER;

-- TheTVDB series metadata
ALTER TABLE releases ADD COLUMN ext_network        TEXT;
ALTER TABLE releases ADD COLUMN ext_series_status  TEXT;

-- Hungarian subtitle / audio tag (detected from release name: HUN, HUNSUB, MULTi+HU)
ALTER TABLE releases ADD COLUMN tag_hun INTEGER NOT NULL DEFAULT 0;

-- Index on IMDB id for ratings lookup
CREATE INDEX IF NOT EXISTS idx_releases_imdb_id
    ON releases(ext_imdb_id)
    WHERE ext_imdb_id IS NOT NULL;

-- Index for stale ratings refresh (find releases with tmdb match but no ratings yet)
CREATE INDEX IF NOT EXISTS idx_releases_ratings_missing
    ON releases(tmdb_id, ext_ratings_fetched_at)
    WHERE tmdb_id IS NOT NULL AND ext_ratings_fetched_at IS NULL;
