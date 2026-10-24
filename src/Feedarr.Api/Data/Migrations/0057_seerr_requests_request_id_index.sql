-- Lookup index used by SeerrWebhookService.HandleWebhook to update an existing
-- request row (PENDING → APPROVED → AVAILABLE) instead of inserting duplicates.
CREATE INDEX IF NOT EXISTS idx_seerr_requests_request_id
    ON seerr_requests(seerr_request_id, seerr_app_id)
    WHERE seerr_request_id IS NOT NULL;
