using System.Globalization;
using System.Text.RegularExpressions;
using Dapper;
using Feedarr.Api.Data;
using Feedarr.Api.Data.Repositories;
using Feedarr.Api.Models.Settings;
using Feedarr.Api.Services.Arr;
using Feedarr.Api.Services.Notifications;
using Microsoft.Extensions.Logging;

namespace Feedarr.Api.Services.Seerr;

/// <summary>
/// Processes incoming webhook events from Overseerr / Jellyseerr.
///
/// Workflow:
///  1. Seerr sends a POST webhook when a media request is approved / available / declined.
///  2. This service persists (upserts) the request in <c>seerr_requests</c>.
///  3. After each RSS sync, <see cref="TryMatchPendingAsync"/> scans unmatched
///     seerr_requests against the releases via TMDB ID (TVDB ID fallback for TV),
///     honouring the requested seasons, Hungarian preference and minimum seeders.
///  4. Optionally the matched release is pushed to Sonarr / Radarr (release/push)
///     and notifications are sent (Discord / ntfy / webhook).
///
/// Seerr webhook setup:
///   Seerr Settings → Notifications → Webhook
///   URL:  http(s)://&lt;feedarr-host&gt;/api/seerr/webhook
///   JSON Payload Type: "Default"
///   Events: Media Requested, Media Auto-Approved, Media Approved, Media Available, Media Declined
///   Authorization Header: required when Feedarr authentication is enabled
///   (e.g. "Basic &lt;base64(user:password)&gt;").
/// </summary>
public sealed class SeerrWebhookService
{
    private readonly Db _db;
    private readonly ILogger<SeerrWebhookService> _log;
    private readonly SettingsRepository? _settings;
    private readonly NotificationService? _notifications;
    private readonly ArrReleasePushService? _arrPush;

    // Seerr notification types we care about
    public const string TypePending      = "MEDIA_PENDING";
    public const string TypeApproved     = "MEDIA_APPROVED";
    public const string TypeAutoApproved = "MEDIA_AUTO_APPROVED";
    public const string TypeAvailable    = "MEDIA_AVAILABLE";
    public const string TypeDeclined     = "MEDIA_DECLINED";
    public const string TypeFailed       = "MEDIA_FAILED";
    /// <summary>Seerr: request created automatically from a Plex / Jellyfin watchlist.</summary>
    public const string TypeAutoRequested = "MEDIA_AUTO_REQUESTED";
    public const string TypeTest         = "TEST_NOTIFICATION";

    /// <summary>Notification types that are persisted. Anything else (issues, etc.) is ignored.</summary>
    private static readonly HashSet<string> StoredTypes = new(StringComparer.Ordinal)
    {
        TypePending, TypeApproved, TypeAutoApproved, TypeAvailable, TypeDeclined, TypeFailed, TypeAutoRequested
    };

    private static readonly HashSet<string> MatchableTypes = new(StringComparer.Ordinal)
    {
        TypeApproved, TypeAutoApproved, TypeAvailable
    };

    /// <summary>SQL list of notification types that make a request eligible for release matching.</summary>
    private const string MatchableTypesSql = "'MEDIA_APPROVED', 'MEDIA_AUTO_APPROVED', 'MEDIA_AVAILABLE'";

    private static readonly Regex YearRegex = new(@"\((\d{4})\)\s*$", RegexOptions.Compiled);
    private static readonly Regex NumberRegex = new(@"\d+", RegexOptions.Compiled);

    // Only one matching pass at a time (sync of several sources runs concurrently).
    private readonly SemaphoreSlim _matchGate = new(1, 1);

    public SeerrWebhookService(
        Db db,
        ILogger<SeerrWebhookService> log,
        SettingsRepository? settings = null,
        NotificationService? notifications = null,
        ArrReleasePushService? arrPush = null)
    {
        _db  = db;
        _log = log;
        _settings = settings;
        _notifications = notifications;
        _arrPush = arrPush;
    }

    private SeerrSettings LoadSettings()
    {
        try
        {
            return _settings?.GetSeerr() ?? new SeerrSettings();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Seerr settings could not be loaded, using defaults");
            return new SeerrSettings();
        }
    }

    // ------------------------------------------------------------------ //
    // Inbound webhook
    // ------------------------------------------------------------------ //

    public sealed record WebhookPayload
    {
        public string?   NotificationType { get; init; }   // MEDIA_APPROVED etc.
        public string?   Subject         { get; init; }    // title, e.g. "Dune (2021)"
        public string?   Message         { get; init; }
        public string?   Image           { get; init; }    // poster URL
        public MediaInfo? Media           { get; init; }
        public RequestInfo? Request       { get; init; }
        /// <summary>"extra" array entries (name/value), e.g. "Requested Seasons" = "1, 2".</summary>
        public IReadOnlyList<KeyValuePair<string, string?>>? Extra { get; init; }

        public sealed record MediaInfo
        {
            public string?  MediaType { get; init; }  // "movie" | "tv"
            public string?  TmdbId    { get; init; }
            public string?  TvdbId    { get; init; }
            public string?  ImdbId    { get; init; }
            public string?  Status    { get; init; }
        }

        public sealed record RequestInfo
        {
            public string? RequestId            { get; init; }
            public string? RequestedByUsername  { get; init; }
        }
    }

    public enum WebhookOutcome { Stored, Updated, Test, Ignored }

    public sealed record WebhookResult(WebhookOutcome Outcome, long? Id, string NotificationType);

    /// <summary>
    /// Persists an inbound Seerr webhook. Repeated events for the same Seerr request
    /// (e.g. PENDING → APPROVED → AVAILABLE) update the existing row instead of
    /// creating duplicates.
    /// </summary>
    public WebhookResult HandleWebhook(WebhookPayload payload, long? seerrAppId = null)
    {
        var type = (payload.NotificationType ?? "").Trim().ToUpperInvariant();

        if (type == TypeTest)
        {
            _log.LogInformation("Seerr webhook test received from appId={AppId}", seerrAppId);
            return new WebhookResult(WebhookOutcome.Test, null, type);
        }

        if (!StoredTypes.Contains(type) || payload.Media is null)
        {
            _log.LogDebug("Seerr webhook ignored: type={Type} hasMedia={HasMedia}", type, payload.Media is not null);
            return new WebhookResult(WebhookOutcome.Ignored, null, type);
        }

        var now       = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var subject   = payload.Subject?.Trim();
        var year      = ExtractYear(subject);
        var title     = string.IsNullOrWhiteSpace(subject) ? "Unknown" : StripYear(subject);
        var mediaType = NormalizeMediaType(payload.Media.MediaType);
        var posterUrl = IsHttpUrl(payload.Image) ? payload.Image!.Trim() : null;
        var seasons   = mediaType == "tv" ? FormatSeasons(ParseSeasons(FindExtra(payload.Extra, "Requested Seasons"))) : null;

        long? tmdbId = TryParseLong(payload.Media.TmdbId);
        long? tvdbId = TryParseLong(payload.Media.TvdbId);
        long? reqId  = TryParseLong(payload.Request?.RequestId);
        var imdbId   = string.IsNullOrWhiteSpace(payload.Media.ImdbId) ? null : payload.Media.ImdbId.Trim();
        var requestedBy = string.IsNullOrWhiteSpace(payload.Request?.RequestedByUsername)
            ? null
            : payload.Request!.RequestedByUsername!.Trim();

        using var conn = _db.Open();
        using var tx = conn.BeginTransaction();

        // Find an existing row for the same Seerr request (or, without request id,
        // the same media) so status transitions update instead of duplicating.
        ExistingRow? existing = null;
        if (reqId.HasValue)
        {
            existing = conn.QueryFirstOrDefault<ExistingRow>(
                """
                SELECT id AS Id, notification_type AS NotificationType FROM seerr_requests
                WHERE seerr_request_id = @reqId
                  AND COALESCE(seerr_app_id, -1) = COALESCE(@appId, -1)
                ORDER BY id DESC
                LIMIT 1
                """,
                new { reqId, appId = seerrAppId }, tx);
        }

        if (existing is null && tmdbId.HasValue)
        {
            existing = conn.QueryFirstOrDefault<ExistingRow>(
                """
                SELECT id AS Id, notification_type AS NotificationType FROM seerr_requests
                WHERE tmdb_id = @tmdbId
                  AND media_type = @mediaType
                  AND COALESCE(seerr_app_id, -1) = COALESCE(@appId, -1)
                  AND (@reqId IS NULL OR seerr_request_id IS NULL OR seerr_request_id = @reqId)
                ORDER BY id DESC
                LIMIT 1
                """,
                new { tmdbId, mediaType, appId = seerrAppId, reqId }, tx);
        }

        long id;
        WebhookOutcome outcome;
        if (existing is not null)
        {
            id = existing.Id;
            outcome = WebhookOutcome.Updated;
            conn.Execute(
                """
                UPDATE seerr_requests SET
                    seerr_request_id  = COALESCE(@reqId, seerr_request_id),
                    media_type        = @mediaType,
                    tmdb_id           = COALESCE(@tmdbId, tmdb_id),
                    tvdb_id           = COALESCE(@tvdbId, tvdb_id),
                    imdb_id           = COALESCE(@imdbId, imdb_id),
                    title             = @title,
                    year              = COALESCE(@year, year),
                    notification_type = @type,
                    requested_by      = COALESCE(@requestedBy, requested_by),
                    poster_url        = COALESCE(@posterUrl, poster_url),
                    requested_seasons = COALESCE(@seasons, requested_seasons),
                    updated_at_ts     = @now
                WHERE id = @id
                """,
                new { id, reqId, mediaType, tmdbId, tvdbId, imdbId, title, year, type, requestedBy, posterUrl, seasons, now }, tx);
        }
        else
        {
            outcome = WebhookOutcome.Stored;
            id = conn.QuerySingle<long>(
                """
                INSERT INTO seerr_requests
                    (seerr_request_id, seerr_app_id, media_type, tmdb_id, tvdb_id, imdb_id,
                     title, year, notification_type, requested_by, poster_url, requested_seasons,
                     received_at_ts, updated_at_ts)
                VALUES
                    (@reqId, @appId, @mediaType, @tmdbId, @tvdbId, @imdbId,
                     @title, @year, @type, @requestedBy, @posterUrl, @seasons,
                     @now, @now)
                RETURNING id;
                """,
                new
                {
                    reqId, appId = seerrAppId, mediaType,
                    tmdbId, tvdbId, imdbId,
                    title, year, type,
                    requestedBy, posterUrl, seasons,
                    now
                }, tx);
        }

        tx.Commit();

        _log.LogInformation(
            "Seerr webhook {Outcome}: id={Id} type={Type} title={Title} tmdbId={TmdbId}",
            outcome, id, type, title, tmdbId);

        // Notify when a request becomes actionable (new approval, not a status refresh).
        var becameMatchable = MatchableTypes.Contains(type) &&
                              type != TypeAvailable &&
                              (existing is null || !MatchableTypes.Contains(existing.NotificationType ?? ""));
        if (becameMatchable)
        {
            var label = year.HasValue ? $"{title} ({year})" : title;
            var seasonText = string.IsNullOrWhiteSpace(seasons) ? "" : $"\nÉvadok: {seasons}";
            _notifications?.NotifyInBackground(new NotificationMessage(
                NotificationEventKind.SeerrRequest,
                $"Új Seerr kérés: {label}",
                $"{(mediaType == "tv" ? "Sorozat" : "Film")} · kérte: {requestedBy ?? "ismeretlen"}{seasonText}",
                Url: tmdbId.HasValue ? TmdbUrl(mediaType, tmdbId.Value) : null,
                ImageUrl: posterUrl,
                Data: new Dictionary<string, object?>
                {
                    ["requestId"] = id, ["mediaType"] = mediaType, ["tmdbId"] = tmdbId, ["seasons"] = seasons
                }));
        }

        return new WebhookResult(outcome, id, type);
    }

    private sealed class ExistingRow
    {
        public long Id { get; set; }
        public string? NotificationType { get; set; }
    }

    // ------------------------------------------------------------------ //
    // Release matching (called after each sync)
    // ------------------------------------------------------------------ //

    public sealed record MatchResult(long SeerrRequestId, long ReleaseId, string Title, string? PushSummary = null);

    /// <summary>
    /// Scans unmatched approved/available Seerr requests and tries to find a
    /// corresponding release.
    /// Matching logic: TMDB ID equality restricted to the same media kind (movie / TV
    /// TMDB ids live in separate namespaces), TVDB ID fallback for TV.
    /// Concurrent calls are coalesced: if a pass is already running, this returns an empty list.
    /// </summary>
    public async Task<List<MatchResult>> TryMatchPendingAsync(CancellationToken ct)
    {
        if (!await _matchGate.WaitAsync(0, ct).ConfigureAwait(false))
            return new List<MatchResult>();

        try
        {
            var settings = LoadSettings();
            var matches = MatchPendingCore(settings, null, ct);
            if (matches.Count == 0) return new List<MatchResult>();

            var results = new List<MatchResult>(matches.Count);
            foreach (var match in matches)
            {
                string? pushSummary = null;
                if (settings.AutoPushToArr && _arrPush is not null)
                {
                    var push = await PushCoreAsync(match.Request, match.ReleaseId, ct).ConfigureAwait(false);
                    pushSummary = push.Summary;
                }

                NotifyMatch(match.Request, match.ReleaseId, match.ReleaseTitle, pushSummary);
                results.Add(new MatchResult(match.Request.Id, match.ReleaseId, match.Request.Title ?? "", pushSummary));
            }
            return results;
        }
        finally
        {
            _matchGate.Release();
        }
    }

    private sealed record PendingMatch(PendingRow Request, long ReleaseId, string? ReleaseTitle);

    private sealed class CandidateRow
    {
        public long Id { get; set; }
        public string? Title { get; set; }
    }

    private List<PendingMatch> MatchPendingCore(SeerrSettings settings, long? onlyRequestId, CancellationToken ct)
    {
        using var conn = _db.Open();

        var pending = conn.Query<PendingRow>(
            $"""
            SELECT id AS Id, media_type AS MediaType, tmdb_id AS TmdbId, tvdb_id AS TvdbId,
                   title AS Title, year AS Year, requested_seasons AS RequestedSeasons,
                   poster_url AS PosterUrl
            FROM seerr_requests
            WHERE matched_release_id IS NULL
              AND notification_type IN ({MatchableTypesSql})
              AND (@onlyId IS NULL OR id = @onlyId)
            ORDER BY received_at_ts DESC
            LIMIT 200
            """,
            new { onlyId = onlyRequestId }).AsList();

        var matches = new List<PendingMatch>();
        if (pending.Count == 0) return matches;

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        foreach (var req in pending)
        {
            ct.ThrowIfCancellationRequested();

            var candidate = FindCandidate(conn, req, settings);
            if (candidate is null) continue;

            var updated = conn.Execute(
                """
                UPDATE seerr_requests
                SET matched_release_id = @rid, matched_at_ts = @now, updated_at_ts = @now
                WHERE id = @id AND matched_release_id IS NULL
                """,
                new { rid = candidate.Id, now, id = req.Id });
            if (updated == 0) continue;

            matches.Add(new PendingMatch(req, candidate.Id, candidate.Title));

            _log.LogInformation(
                "Seerr request matched: seerrReqId={SId} releaseId={RId} title={Title}",
                req.Id, candidate.Id, req.Title);
        }

        return matches;
    }

    private static CandidateRow? FindCandidate(System.Data.IDbConnection conn, PendingRow req, SeerrSettings settings)
    {
        var isTv = string.Equals(req.MediaType, "tv", StringComparison.OrdinalIgnoreCase);
        var seasons = isTv ? ParseSeasons(req.RequestedSeasons) : new List<int>();
        var seasonsSql = seasons.Count > 0 ? string.Join(",", seasons) : "NULL";

        // Seasons: requested season packs first, then single episodes of the requested
        // seasons, then releases without season info (complete series packs).
        var seasonFilter = isTv && seasons.Count > 0 && settings.StrictSeasonMatch
            ? $"AND (r.season IS NULL OR r.season IN ({seasonsSql}))"
            : "";
        var seasonOrder = isTv && seasons.Count > 0
            ? $"CASE WHEN r.season IN ({seasonsSql}) AND r.episode IS NULL THEN 0 " +
              $"WHEN r.season IN ({seasonsSql}) THEN 1 WHEN r.season IS NULL THEN 2 ELSE 3 END,"
            : "";
        var hunOrder = settings.PreferHungarian ? "COALESCE(r.tag_hun, 0) DESC," : "";
        var seedersFilter = settings.MinSeeders > 0 ? "AND COALESCE(r.seeders, 0) >= @minSeeders" : "";

        CandidateRow? candidate = null;

        // Try TMDB match first (release-level id or the entity id)
        if (req.TmdbId.HasValue)
        {
            var mediaFilter = isTv
                ? "LOWER(COALESCE(r.media_type, '')) IN ('series', 'tv', 'show', 'anime')"
                : "LOWER(COALESCE(r.media_type, '')) NOT IN ('series', 'tv', 'show', 'game', 'audio', 'book', 'comic')";

            candidate = conn.QueryFirstOrDefault<CandidateRow>(
                $"""
                SELECT r.id AS Id, r.title AS Title FROM releases r
                WHERE (r.tmdb_id = @tmdbId
                       OR r.entity_id IN (SELECT me.id FROM media_entities me WHERE me.tmdb_id = @tmdbId))
                  AND {mediaFilter}
                  {seasonFilter}
                  {seedersFilter}
                ORDER BY {seasonOrder} {hunOrder} COALESCE(r.seeders, 0) DESC, r.published_at_ts DESC
                LIMIT 1
                """,
                new { tmdbId = req.TmdbId.Value, minSeeders = settings.MinSeeders });
        }

        // Fallback: TVDB match for TV series
        if (candidate is null && req.TvdbId.HasValue && isTv)
        {
            candidate = conn.QueryFirstOrDefault<CandidateRow>(
                $"""
                SELECT r.id AS Id, r.title AS Title FROM releases r
                WHERE (r.tvdb_id = @tvdbId
                       OR r.entity_id IN (SELECT me.id FROM media_entities me WHERE me.tvdb_id = @tvdbId))
                  {seasonFilter}
                  {seedersFilter}
                ORDER BY {seasonOrder} {hunOrder} COALESCE(r.seeders, 0) DESC, r.published_at_ts DESC
                LIMIT 1
                """,
                new { tvdbId = req.TvdbId.Value, minSeeders = settings.MinSeeders });
        }

        return candidate;
    }

    private void NotifyMatch(PendingRow req, long releaseId, string? releaseTitle, string? pushSummary)
    {
        if (_notifications is null) return;
        var label = req.Year.HasValue ? $"{req.Title} ({req.Year})" : req.Title ?? "";
        var message = $"Release: {releaseTitle ?? $"#{releaseId}"}";
        if (!string.IsNullOrWhiteSpace(pushSummary))
            message += $"\nSonarr/Radarr: {pushSummary}";

        _notifications.NotifyInBackground(new NotificationMessage(
            NotificationEventKind.SeerrMatch,
            $"Megérkezett: {label}",
            message,
            Url: req.TmdbId.HasValue ? TmdbUrl(req.MediaType, req.TmdbId.Value) : null,
            ImageUrl: req.PosterUrl,
            Data: new Dictionary<string, object?>
            {
                ["requestId"] = req.Id, ["releaseId"] = releaseId, ["releaseTitle"] = releaseTitle,
                ["tmdbId"] = req.TmdbId, ["push"] = pushSummary
            }));
    }

    // ------------------------------------------------------------------ //
    // Manual actions
    // ------------------------------------------------------------------ //

    /// <summary>Runs matching for a single request (after a reset, for example).</summary>
    public async Task<MatchResult?> MatchOneAsync(long id, CancellationToken ct)
    {
        await _matchGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var settings = LoadSettings();
            var match = MatchPendingCore(settings, id, ct).FirstOrDefault();
            if (match is null) return null;

            string? pushSummary = null;
            if (settings.AutoPushToArr && _arrPush is not null)
                pushSummary = (await PushCoreAsync(match.Request, match.ReleaseId, ct).ConfigureAwait(false)).Summary;

            NotifyMatch(match.Request, match.ReleaseId, match.ReleaseTitle, pushSummary);
            return new MatchResult(match.Request.Id, match.ReleaseId, match.Request.Title ?? "", pushSummary);
        }
        finally
        {
            _matchGate.Release();
        }
    }

    public bool Delete(long id)
    {
        using var conn = _db.Open();
        return conn.Execute("DELETE FROM seerr_requests WHERE id = @id", new { id }) > 0;
    }

    /// <summary>Clears the match (and push result) so the request is matched again.</summary>
    public bool ResetMatch(long id)
    {
        using var conn = _db.Open();
        return conn.Execute(
            """
            UPDATE seerr_requests SET
                matched_release_id = NULL, matched_at_ts = NULL,
                arr_push_status = NULL, arr_push_message = NULL, arr_pushed_at_ts = NULL,
                updated_at_ts = @now
            WHERE id = @id
            """,
            new { id, now = DateTimeOffset.UtcNow.ToUnixTimeSeconds() }) > 0;
    }

    public sealed record PushResponse(bool Ok, bool Approved, string Status, string Summary, string? AppName);

    /// <summary>Pushes the matched release of a request to Sonarr / Radarr.</summary>
    public async Task<PushResponse?> PushMatchedAsync(long id, CancellationToken ct)
    {
        PendingRow? req;
        long? releaseId;
        using (var conn = _db.Open())
        {
            req = conn.QueryFirstOrDefault<PendingRow>(
                """
                SELECT id AS Id, media_type AS MediaType, tmdb_id AS TmdbId, tvdb_id AS TvdbId,
                       title AS Title, year AS Year, requested_seasons AS RequestedSeasons,
                       poster_url AS PosterUrl
                FROM seerr_requests WHERE id = @id
                """, new { id });
            releaseId = conn.ExecuteScalar<long?>(
                "SELECT matched_release_id FROM seerr_requests WHERE id = @id", new { id });
        }

        if (req is null) return null;
        if (!releaseId.HasValue)
            return new PushResponse(false, false, "error", "A kéréshez még nincs egyeztetett release.", null);
        if (_arrPush is null)
            return new PushResponse(false, false, "error", "Release push nem elérhető.", null);

        var outcome = await PushCoreAsync(req, releaseId.Value, ct).ConfigureAwait(false);
        return new PushResponse(outcome.Ok, outcome.Approved, StatusOf(outcome), outcome.Summary, outcome.AppName);
    }

    private async Task<ArrReleasePushService.PushOutcome> PushCoreAsync(PendingRow req, long releaseId, CancellationToken ct)
    {
        ArrReleasePushService.PushOutcome outcome;
        try
        {
            outcome = await _arrPush!.PushAsync(releaseId, req.MediaType ?? "movie", null, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Seerr: release push failed for request {Id}", req.Id);
            outcome = new ArrReleasePushService.PushOutcome(false, false, req.MediaType == "tv" ? "sonarr" : "radarr",
                null, "", Array.Empty<string>(), ex.Message);
        }

        using (var conn = _db.Open())
        {
            conn.Execute(
                """
                UPDATE seerr_requests SET
                    arr_push_status = @status, arr_push_message = @message,
                    arr_pushed_at_ts = @now, updated_at_ts = @now
                WHERE id = @id
                """,
                new
                {
                    id = req.Id,
                    status = StatusOf(outcome),
                    message = outcome.Summary.Length > 1000 ? outcome.Summary[..1000] : outcome.Summary,
                    now = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
                });
        }

        _notifications?.NotifyInBackground(new NotificationMessage(
            NotificationEventKind.ArrPush,
            $"{(outcome.AppType == "sonarr" ? "Sonarr" : "Radarr")}: {req.Title}",
            $"{outcome.Summary}\n{outcome.ReleaseTitle}".Trim(),
            Url: req.TmdbId.HasValue ? TmdbUrl(req.MediaType, req.TmdbId.Value) : null,
            ImageUrl: req.PosterUrl,
            IsError: !outcome.Ok || !outcome.Approved,
            Data: new Dictionary<string, object?>
            {
                ["requestId"] = req.Id, ["releaseId"] = releaseId, ["app"] = outcome.AppName,
                ["approved"] = outcome.Approved, ["rejections"] = outcome.Rejections
            }));

        return outcome;
    }

    private static string StatusOf(ArrReleasePushService.PushOutcome o)
        => !o.Ok ? "error" : o.Approved ? "approved" : "rejected";

    // ------------------------------------------------------------------ //
    // Read / list
    // ------------------------------------------------------------------ //

    public sealed record SeerrRequestRow
    {
        public long    Id               { get; init; }
        public long?   SeerrRequestId   { get; init; }
        public string? MediaType        { get; init; }
        public long?   TmdbId           { get; init; }
        public long?   TvdbId           { get; init; }
        public string? Title            { get; init; }
        public long?   Year             { get; init; }
        public string? NotificationType { get; init; }
        public string? RequestedBy      { get; init; }
        public string? PosterUrl        { get; init; }
        public string? RequestedSeasons { get; init; }
        public long?   MatchedReleaseId { get; init; }
        public string? MatchedReleaseTitle { get; init; }
        public long?   MatchedReleaseSeeders { get; init; }
        public long?   MatchedReleaseSize { get; init; }
        public long?   MatchedReleaseHun { get; init; }
        public long?   MatchedAtTs      { get; init; }
        public string? ArrPushStatus    { get; init; }
        public string? ArrPushMessage   { get; init; }
        public long?   ArrPushedAtTs    { get; init; }
        public long    ReceivedAtTs     { get; init; }
        public long    UpdatedAtTs      { get; init; }
    }

    private const string SelectRowsSql = """
        SELECT s.id AS Id, s.seerr_request_id AS SeerrRequestId, s.media_type AS MediaType,
               s.tmdb_id AS TmdbId, s.tvdb_id AS TvdbId, s.title AS Title, s.year AS Year,
               s.notification_type AS NotificationType, s.requested_by AS RequestedBy,
               s.poster_url AS PosterUrl, s.requested_seasons AS RequestedSeasons,
               s.matched_release_id AS MatchedReleaseId, r.title AS MatchedReleaseTitle,
               r.seeders AS MatchedReleaseSeeders, r.size_bytes AS MatchedReleaseSize,
               r.tag_hun AS MatchedReleaseHun,
               s.matched_at_ts AS MatchedAtTs,
               s.arr_push_status AS ArrPushStatus, s.arr_push_message AS ArrPushMessage,
               s.arr_pushed_at_ts AS ArrPushedAtTs,
               s.received_at_ts AS ReceivedAtTs, s.updated_at_ts AS UpdatedAtTs
        FROM seerr_requests s
        LEFT JOIN releases r ON r.id = s.matched_release_id
        """;

    public List<SeerrRequestRow> GetRecent(int limit = 100)
    {
        var lim = Math.Clamp(limit, 1, 500);
        using var conn = _db.Open();
        return conn.Query<SeerrRequestRow>(
            $"""
            {SelectRowsSql}
            ORDER BY s.updated_at_ts DESC, s.id DESC
            LIMIT @limit
            """,
            new { limit = lim }).AsList();
    }

    public List<SeerrRequestRow> GetMatched(int limit = 100)
    {
        var lim = Math.Clamp(limit, 1, 500);
        using var conn = _db.Open();
        return conn.Query<SeerrRequestRow>(
            $"""
            {SelectRowsSql}
            WHERE s.matched_release_id IS NOT NULL
            ORDER BY s.matched_at_ts DESC, s.id DESC
            LIMIT @limit
            """,
            new { limit = lim }).AsList();
    }

    public List<SeerrRequestRow> GetUnmatched(int limit = 100)
    {
        var lim = Math.Clamp(limit, 1, 500);
        using var conn = _db.Open();
        return conn.Query<SeerrRequestRow>(
            $"""
            {SelectRowsSql}
            WHERE s.matched_release_id IS NULL
              AND s.notification_type IN ({MatchableTypesSql})
            ORDER BY s.updated_at_ts DESC, s.id DESC
            LIMIT @limit
            """,
            new { limit = lim }).AsList();
    }

    public sealed record SeerrStats(long Total, long Pending, long Matched, long Pushed, long Declined);

    public SeerrStats GetStats()
    {
        using var conn = _db.Open();
        return conn.QueryFirstOrDefault<SeerrStats>(
            $"""
            SELECT COUNT(*) AS Total,
                   COALESCE(SUM(CASE WHEN matched_release_id IS NULL AND notification_type IN ({MatchableTypesSql}) THEN 1 ELSE 0 END), 0) AS Pending,
                   COALESCE(SUM(CASE WHEN matched_release_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS Matched,
                   COALESCE(SUM(CASE WHEN arr_push_status = 'approved' THEN 1 ELSE 0 END), 0) AS Pushed,
                   COALESCE(SUM(CASE WHEN notification_type = 'MEDIA_DECLINED' THEN 1 ELSE 0 END), 0) AS Declined
            FROM seerr_requests
            """) ?? new SeerrStats(0, 0, 0, 0, 0);
    }

    // ------------------------------------------------------------------ //
    // Helpers
    // ------------------------------------------------------------------ //

    private sealed class PendingRow
    {
        public long    Id        { get; set; }
        public string? MediaType { get; set; }
        public long?   TmdbId    { get; set; }
        public long?   TvdbId    { get; set; }
        public string? Title     { get; set; }
        public long?   Year      { get; set; }
        public string? RequestedSeasons { get; set; }
        public string? PosterUrl { get; set; }
    }

    internal static string NormalizeMediaType(string? mediaType)
    {
        var normalized = (mediaType ?? "").Trim().ToLowerInvariant();
        return normalized is "tv" or "series" or "show" ? "tv" : "movie";
    }

    internal static long? TryParseLong(string? s)
        => long.TryParse(s?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) && n > 0 ? n : null;

    internal static int? ExtractYear(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        var m = YearRegex.Match(title);
        return m.Success && int.TryParse(m.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var y) ? y : null;
    }

    internal static string StripYear(string title)
    {
        var stripped = YearRegex.Replace(title, "").Trim();
        return stripped.Length == 0 ? title.Trim() : stripped;
    }

    /// <summary>Parses "1, 2", "Season 1, Season 3" or "1,2,3" into distinct season numbers.</summary>
    internal static List<int> ParseSeasons(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new List<int>();
        return NumberRegex.Matches(raw)
            .Select(m => int.TryParse(m.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : -1)
            .Where(n => n >= 0 && n < 1000)
            .Distinct()
            .OrderBy(n => n)
            .ToList();
    }

    private static string? FormatSeasons(List<int> seasons)
        => seasons.Count == 0 ? null : string.Join(",", seasons);

    private static string? FindExtra(IReadOnlyList<KeyValuePair<string, string?>>? extra, string name)
        => extra?.FirstOrDefault(e => string.Equals(e.Key?.Trim(), name, StringComparison.OrdinalIgnoreCase)).Value;

    private static bool IsHttpUrl(string? url)
        => !string.IsNullOrWhiteSpace(url) &&
           Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u) &&
           (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps);

    private static string TmdbUrl(string? mediaType, long tmdbId)
        => $"https://www.themoviedb.org/{(string.Equals(mediaType, "tv", StringComparison.OrdinalIgnoreCase) ? "tv" : "movie")}/{tmdbId}";
}
