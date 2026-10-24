-- Hungarian localised metadata fields for media_entities
-- (mirrors the columns added to releases in 0054_hungarian_metadata_and_ratings.sql)
-- Required by:
--   ReleaseRepository.UpdateExternalDetails (media_entities UPDATE)
--   ReleaseRepository.GetTmdbMetadataDonorsByTmdbIds (SELECT COALESCE(me.ext_title_hu, ...))
--   RatingsBackfillService (media_entities UPDATE for ratings)

ALTER TABLE media_entities ADD COLUMN ext_title_hu      TEXT;
ALTER TABLE media_entities ADD COLUMN ext_overview_hu   TEXT;
ALTER TABLE media_entities ADD COLUMN ext_title_original TEXT;

-- OMDb ratings fields (IMDb score, Rotten Tomatoes %, Metascore)
-- Note: media_entities already has `imdb_id` (from migration 0019).
-- ext_imdb_id is the OMDb-fetched ID (may differ slightly in format).
ALTER TABLE media_entities ADD COLUMN ext_imdb_id      TEXT;
ALTER TABLE media_entities ADD COLUMN ext_imdb_score   REAL;
ALTER TABLE media_entities ADD COLUMN ext_imdb_votes   INTEGER;
ALTER TABLE media_entities ADD COLUMN ext_rt_score     INTEGER;
ALTER TABLE media_entities ADD COLUMN ext_metascore    INTEGER;

CREATE INDEX IF NOT EXISTS idx_media_entities_ext_imdb_id
    ON media_entities(ext_imdb_id)
    WHERE ext_imdb_id IS NOT NULL;
