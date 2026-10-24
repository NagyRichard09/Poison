using System.Globalization;
using Dapper;
using Feedarr.Api.Data;
using Feedarr.Api.Data.Repositories;

namespace Feedarr.Api.Services.Arr;

/// <summary>
/// Sends a Feedarr release to the default Sonarr (TV) or Radarr (movie) instance
/// through the arr "release push" API, like autobrr does. The arr app parses the
/// title, checks it against its quality profile and grabs it when approved.
/// </summary>
public sealed class ArrReleasePushService
{
    private readonly Db _db;
    private readonly ArrApplicationRepository _apps;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ArrReleasePushService> _log;

    public ArrReleasePushService(
        Db db,
        ArrApplicationRepository apps,
        IServiceScopeFactory scopeFactory,
        ILogger<ArrReleasePushService> log)
    {
        _db = db;
        _apps = apps;
        _scopeFactory = scopeFactory;
        _log = log;
    }

    public sealed record PushOutcome(
        bool Ok,
        bool Approved,
        string AppType,
        string? AppName,
        string ReleaseTitle,
        IReadOnlyList<string> Rejections,
        string? Error)
    {
        public string Summary =>
            !Ok ? $"Hiba: {Error}" :
            Approved ? "Elfogadva – letöltés elindítva" :
            Rejections.Count > 0 ? "Elutasítva: " + string.Join("; ", Rejections) :
            "Elküldve (nincs döntés)";
    }

    private sealed class ReleaseRow
    {
        public long Id { get; set; }
        public string? Title { get; set; }
        public string? Guid { get; set; }
        public string? Link { get; set; }
        public string? DownloadUrl { get; set; }
        public string? InfoHash { get; set; }
        public long? SizeBytes { get; set; }
        public long? Seeders { get; set; }
        public long? Leechers { get; set; }
        public long? PublishedAtTs { get; set; }
        public long? TmdbId { get; set; }
        public long? TvdbId { get; set; }
        public string? SourceName { get; set; }
    }

    /// <param name="mediaType">"movie" → Radarr, "tv" → Sonarr.</param>
    /// <param name="appId">Optional explicit arr_applications.id; default app of the type otherwise.</param>
    public async Task<PushOutcome> PushAsync(long releaseId, string mediaType, long? appId, CancellationToken ct)
    {
        var appType = string.Equals(mediaType, "tv", StringComparison.OrdinalIgnoreCase) ? "sonarr" : "radarr";

        var release = LoadRelease(releaseId);
        if (release is null)
            return new PushOutcome(false, false, appType, null, "", Array.Empty<string>(), "release not found");

        var title = release.Title?.Trim() ?? "";
        var app = appId.HasValue ? _apps.Get(appId.Value) : _apps.GetDefault(appType);
        if (app is not null && !string.Equals(app.Type, appType, StringComparison.OrdinalIgnoreCase))
            app = null;
        if (app is null || !app.IsEnabled)
        {
            return new PushOutcome(false, false, appType, null, title, Array.Empty<string>(),
                $"nincs engedélyezett {(appType == "sonarr" ? "Sonarr" : "Radarr")} alkalmazás beállítva");
        }

        var request = BuildRequest(release);
        if (request.DownloadUrl is null && request.MagnetUrl is null)
        {
            return new PushOutcome(false, false, appType, app.Name, title, Array.Empty<string>(),
                "a release-nek nincs letöltési linkje");
        }

        using var scope = _scopeFactory.CreateScope();
        ArrReleasePushResult result = appType == "sonarr"
            ? await scope.ServiceProvider.GetRequiredService<SonarrClient>()
                .PushReleaseAsync(app.BaseUrl, app.ApiKeyEncrypted, request, ct).ConfigureAwait(false)
            : await scope.ServiceProvider.GetRequiredService<RadarrClient>()
                .PushReleaseAsync(app.BaseUrl, app.ApiKeyEncrypted, request, ct).ConfigureAwait(false);

        _log.LogInformation(
            "Release push to {AppType} app={AppName} releaseId={ReleaseId} ok={Ok} approved={Approved} rejections={Rejections}",
            appType, app.Name, releaseId, result.Ok, result.Approved, string.Join(" | ", result.Rejections));

        return new PushOutcome(result.Ok, result.Approved, appType, app.Name ?? appType, title, result.Rejections, result.Error);
    }

    private ReleaseRow? LoadRelease(long releaseId)
    {
        using var conn = _db.Open();
        return conn.QueryFirstOrDefault<ReleaseRow>(
            """
            SELECT r.id AS Id, r.title AS Title, r.guid AS Guid, r.link AS Link,
                   r.download_url AS DownloadUrl, r.info_hash AS InfoHash,
                   r.size_bytes AS SizeBytes, r.seeders AS Seeders, r.leechers AS Leechers,
                   r.published_at_ts AS PublishedAtTs,
                   COALESCE(r.tmdb_id, me.tmdb_id) AS TmdbId,
                   COALESCE(r.tvdb_id, me.tvdb_id) AS TvdbId,
                   s.name AS SourceName
            FROM releases r
            LEFT JOIN media_entities me ON me.id = r.entity_id
            LEFT JOIN sources s ON s.id = r.source_id
            WHERE r.id = @id
            """,
            new { id = releaseId });
    }

    private static ArrReleasePushRequest BuildRequest(ReleaseRow r)
    {
        var downloadUrl = r.DownloadUrl?.Trim();
        string? magnet = null;
        if (!string.IsNullOrWhiteSpace(downloadUrl) &&
            downloadUrl.StartsWith("magnet:", StringComparison.OrdinalIgnoreCase))
        {
            magnet = downloadUrl;
            downloadUrl = null;
        }
        else if (string.IsNullOrWhiteSpace(downloadUrl))
        {
            downloadUrl = null;
            if (!string.IsNullOrWhiteSpace(r.InfoHash))
            {
                magnet = $"magnet:?xt=urn:btih:{r.InfoHash.Trim()}&dn={Uri.EscapeDataString(r.Title ?? "")}";
            }
        }

        var published = r.PublishedAtTs is > 0
            ? DateTimeOffset.FromUnixTimeSeconds(r.PublishedAtTs.Value)
            : DateTimeOffset.UtcNow;

        return new ArrReleasePushRequest
        {
            Title = r.Title?.Trim() ?? "",
            DownloadUrl = downloadUrl,
            MagnetUrl = magnet,
            InfoUrl = string.IsNullOrWhiteSpace(r.Link) ? null : r.Link,
            Guid = string.IsNullOrWhiteSpace(r.Guid) ? $"feedarr-{r.Id}" : r.Guid,
            Size = r.SizeBytes is > 0 ? r.SizeBytes : null,
            Seeders = r.Seeders.HasValue ? (int)Math.Clamp(r.Seeders.Value, 0, int.MaxValue) : null,
            Leechers = r.Leechers.HasValue ? (int)Math.Clamp(r.Leechers.Value, 0, int.MaxValue) : null,
            Indexer = string.IsNullOrWhiteSpace(r.SourceName) ? "Poisonarr" : $"{r.SourceName} (Poisonarr)",
            PublishDate = published.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
            TmdbId = r.TmdbId is > 0 and <= int.MaxValue ? (int)r.TmdbId.Value : null,
            TvdbId = r.TvdbId is > 0 and <= int.MaxValue ? (int)r.TvdbId.Value : null,
        };
    }
}
