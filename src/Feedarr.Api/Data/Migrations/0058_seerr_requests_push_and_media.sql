-- Seerr integration v2:
--  * poster image + requested seasons from the webhook payload ("image", "extra")
--  * result of pushing the matched release to Sonarr / Radarr (release/push API)
ALTER TABLE seerr_requests ADD COLUMN poster_url        TEXT;
ALTER TABLE seerr_requests ADD COLUMN requested_seasons TEXT;   -- e.g. "1,2"
ALTER TABLE seerr_requests ADD COLUMN arr_push_status   TEXT;   -- approved | rejected | error
ALTER TABLE seerr_requests ADD COLUMN arr_push_message  TEXT;
ALTER TABLE seerr_requests ADD COLUMN arr_pushed_at_ts  INTEGER;
