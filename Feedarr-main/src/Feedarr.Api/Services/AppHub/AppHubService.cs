using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Feedarr.Api.Data.Repositories;
using Feedarr.Api.Models.Settings;
using Feedarr.Api.Options;
using Microsoft.Extensions.Options;

namespace Feedarr.Api.Services.AppHub;

public sealed record AppLinkStatus(
    string Id,
    bool Online,
    int? HttpStatus,
    long? ElapsedMs,
    bool? Embeddable,
    string? Error);

public sealed record AutoSetupOptions
{
    public bool CreateLinks { get; init; } = true;
    public bool RegisterArrApps { get; init; } = true;
    public bool RegisterProwlarr { get; init; } = true;
    public bool ProwlarrSyncApps { get; init; } = true;
    public bool SeerrWebhook { get; init; } = true;
    public bool SeerrArrServers { get; init; } = true;
    public bool CreateRootFolders { get; init; } = true;
    public string TvRootFolder { get; init; } = "/srv/media/tv";
    public string MoviesRootFolder { get; init; } = "/srv/media/movies";
    public string? QbittorrentUsername { get; init; }
    public string? QbittorrentPassword { get; init; }
}

public sealed record AutoSetupStep(string Step, bool Ok, string Message);

/// <summary>
/// "Alkalmazások" hub: sidebar links to Seerr / Prowlarr / Sonarr / Radarr / Tautulli /
/// qBittorrent, their online status, API key discovery from the shared config folders and
/// a one-click auto setup that wires the apps together:
///   Feedarr  ← Prowlarr (indexer provider), Sonarr, Radarr (arr applications)
///   Prowlarr → Sonarr, Radarr (application sync)
///   Sonarr / Radarr → qBittorrent (download client), root folders
///   Seerr → Sonarr, Radarr (servers), Feedarr (webhook)
/// Every step is idempotent: existing configuration is detected and left untouched.
/// </summary>
public sealed class AppHubService
{
    public const string HttpClientName = "apphub";

    private static readonly Regex IdRegex = new("^[a-z0-9][a-z0-9-]{0,39}$", RegexOptions.Compiled);

    // Seerr notification bit flags (server/lib/notifications/index.ts)
    private const int SeerrTypesMask = 2 | 4 | 8 | 16 | 64 | 128; // pending, approved, available, failed, declined, auto-approved

    private readonly SettingsRepository _settings;
    private readonly ArrApplicationRepository _arrApps;
    private readonly ProviderRepository _providers;
    private readonly IHttpClientFactory _httpFactory;
    private readonly AppOptions _opts;
    private readonly ILogger<AppHubService> _log;

    public AppHubService(
        SettingsRepository settings,
        ArrApplicationRepository arrApps,
        ProviderRepository providers,
        IHttpClientFactory httpFactory,
        IOptions<AppOptions> opts,
        ILogger<AppHubService> log)
    {
        _settings = settings;
        _arrApps = arrApps;
        _providers = providers;
        _httpFactory = httpFactory;
        _opts = opts.Value;
        _log = log;
    }

    // ------------------------------------------------------------------ //
    // Links
    // ------------------------------------------------------------------ //

    public List<AppLink> GetLinks() => _settings.GetAppLinks().Links;

    public string? ValidateLinks(List<AppLink> links)
    {
        if (links.Count > AppLinksSettings.MaxLinks)
            return $"Legfeljebb {AppLinksSettings.MaxLinks} alkalmazás adható meg.";

        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var l in links)
        {
            if (!IdRegex.IsMatch(l.Id ?? ""))
                return $"Érvénytelen azonosító: '{l.Id}' (kisbetű, szám, kötőjel).";
            if (!ids.Add(l.Id!))
                return $"Duplikált azonosító: {l.Id}";
            if (string.IsNullOrWhiteSpace(l.Name) || l.Name.Length > 60)
                return $"Hiányzó vagy túl hosszú név: {l.Id}";
            if (!AppCatalog.IsKnownType(l.Type))
                return $"Ismeretlen típus: {l.Type}";
            if (!IsValidLinkUrl(l.Url))
                return $"Érvénytelen URL ({l.Name}): csak http(s), a {{host}} helyettesítő használható.";
            if (!string.IsNullOrWhiteSpace(l.InternalUrl) && !IsValidLinkUrl(l.InternalUrl))
                return $"Érvénytelen belső URL ({l.Name}).";
            if (l.OpenMode is not ("embed" or "tab"))
                return $"Érvénytelen megnyitási mód ({l.Name}).";
        }
        return null;
    }

    public void SaveLinks(List<AppLink> links)
    {
        foreach (var l in links)
        {
            l.Id = l.Id.Trim();
            l.Name = l.Name.Trim();
            l.Type = l.Type.Trim().ToLowerInvariant();
            l.Url = l.Url.Trim();
            l.InternalUrl = string.IsNullOrWhiteSpace(l.InternalUrl) ? null : l.InternalUrl.Trim();
        }
        _settings.SaveAppLinks(new AppLinksSettings { Links = links });
    }

    internal static bool IsValidLinkUrl(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 500) return false;
        var probe = raw.Trim().Replace("{host}", "placeholder.local", StringComparison.Ordinal);
        return Uri.TryCreate(probe, UriKind.Absolute, out var u) &&
               (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps);
    }

    /// <summary>Resolves "{host}" for server side use.</summary>
    internal static string ResolveHost(string url, string host)
        => url.Replace("{host}", string.IsNullOrWhiteSpace(host) ? "127.0.0.1" : host, StringComparison.Ordinal);

    /// <summary>Default link for a known app (browser: {host}:port, server: 127.0.0.1:port).</summary>
    public static AppLink BuildDefaultLink(AppDefinition def, int? port = null, string? urlBase = null)
    {
        var p = port ?? def.DefaultPort;
        var basePath = string.IsNullOrWhiteSpace(urlBase) ? "" : urlBase;
        return new AppLink
        {
            Id = def.Type,
            Name = def.Name,
            Type = def.Type,
            Url = $"http://{{host}}:{p}{basePath}",
            InternalUrl = $"http://127.0.0.1:{p}{basePath}",
            OpenMode = def.Type == "qbittorrent" ? "tab" : "embed",
            Enabled = true
        };
    }

    // ------------------------------------------------------------------ //
    // Status
    // ------------------------------------------------------------------ //

    public async Task<List<AppLinkStatus>> CheckStatusAsync(string requestHost, CancellationToken ct)
    {
        var links = GetLinks().Where(l => l.Enabled).ToList();
        var tasks = links.Select(l => CheckOneAsync(l, requestHost, ct));
        return (await Task.WhenAll(tasks).ConfigureAwait(false)).ToList();
    }

    private async Task<AppLinkStatus> CheckOneAsync(AppLink link, string requestHost, CancellationToken ct)
    {
        var baseUrl = ResolveHost(link.InternalUrl ?? link.Url, requestHost).TrimEnd('/');
        var def = AppCatalog.Find(link.Type);
        var client = _httpFactory.CreateClient(HttpClientName);
        var sw = Stopwatch.StartNew();
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(5));

            // The base page tells whether the app may be framed (X-Frame-Options / CSP frame-ancestors).
            using var resp = await client.GetAsync(baseUrl + "/", HttpCompletionOption.ResponseHeadersRead, cts.Token)
                .ConfigureAwait(false);
            var status = (int)resp.StatusCode;
            var embeddable = EvaluateEmbeddable(resp);

            var online = status < 500;
            if (online && def is not null && def.HealthPath != "/")
            {
                using var health = await client.GetAsync(baseUrl + def.HealthPath, HttpCompletionOption.ResponseHeadersRead, cts.Token)
                    .ConfigureAwait(false);
                online = (int)health.StatusCode < 500;
            }

            return new AppLinkStatus(link.Id, online, status, sw.ElapsedMilliseconds, embeddable,
                online ? null : $"HTTP {status}");
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new AppLinkStatus(link.Id, false, null, sw.ElapsedMilliseconds, null, "időtúllépés");
        }
        catch (HttpRequestException ex)
        {
            return new AppLinkStatus(link.Id, false, null, sw.ElapsedMilliseconds, null,
                Feedarr.Api.Services.Security.ErrorMessageSanitizer.Sanitize(ex.Message, "nem elérhető"));
        }
    }

    /// <summary>
    /// false when the app forbids framing by another origin (X-Frame-Options DENY/SAMEORIGIN or a
    /// restrictive CSP frame-ancestors), null when it cannot be determined.
    /// </summary>
    internal static bool? EvaluateEmbeddable(HttpResponseMessage resp)
    {
        if (resp.Headers.TryGetValues("X-Frame-Options", out var xfo))
        {
            var value = string.Join(",", xfo).Trim().ToUpperInvariant();
            if (value.Contains("DENY") || value.Contains("SAMEORIGIN")) return false;
        }

        IEnumerable<string>? csp = null;
        if (resp.Headers.TryGetValues("Content-Security-Policy", out var h1)) csp = h1;
        else if (resp.Content.Headers.TryGetValues("Content-Security-Policy", out var h2)) csp = h2;
        if (csp is not null)
        {
            foreach (var directive in string.Join(";", csp).Split(';'))
            {
                var d = directive.Trim();
                if (!d.StartsWith("frame-ancestors", StringComparison.OrdinalIgnoreCase)) continue;
                var sources = d["frame-ancestors".Length..].Trim();
                if (sources.Contains('*')) return true;
                if (sources.Contains("'none'") || sources == "'self'") return false;
                return null; // explicit allow-list: depends on the Feedarr origin
            }
        }
        return true;
    }

    // ------------------------------------------------------------------ //
    // Discovery
    // ------------------------------------------------------------------ //

    public string ConfigRoot => _opts.AppConfigRoot;

    public List<DiscoveredApp> Discover() => AppConfigDiscovery.Discover(_opts.AppConfigRoot, _log);

    // ------------------------------------------------------------------ //
    // Auto setup
    // ------------------------------------------------------------------ //

    public async Task<List<AutoSetupStep>> AutoSetupAsync(AutoSetupOptions o, CancellationToken ct)
    {
        var steps = new List<AutoSetupStep>();
        var found = Discover().ToDictionary(d => d.Type, StringComparer.OrdinalIgnoreCase);
        if (found.Count == 0)
        {
            steps.Add(new AutoSetupStep("discover", false,
                $"Nem található alkalmazás konfiguráció itt: {_opts.AppConfigRoot}"));
            return steps;
        }

        steps.Add(new AutoSetupStep("discover", true,
            "Megtalálva: " + string.Join(", ", found.Values.Select(f => f.Name + (f.HasApiKey ? " 🔑" : "")))));

        string Internal(DiscoveredApp a) => $"http://127.0.0.1:{a.Port}{a.UrlBase ?? ""}";

        // 1) Sidebar links
        if (o.CreateLinks)
        {
            var links = GetLinks();
            var added = new List<string>();
            foreach (var app in found.Values)
            {
                if (links.Any(l => string.Equals(l.Type, app.Type, StringComparison.OrdinalIgnoreCase))) continue;
                var def = AppCatalog.Find(app.Type)!;
                links.Add(BuildDefaultLink(def, app.Port, app.UrlBase));
                added.Add(app.Name);
            }
            if (added.Count > 0) SaveLinks(OrderLinks(links));
            steps.Add(new AutoSetupStep("links", true,
                added.Count > 0 ? "Menüpontok létrehozva: " + string.Join(", ", added) : "A menüpontok már léteznek."));
        }

        found.TryGetValue("sonarr", out var sonarr);
        found.TryGetValue("radarr", out var radarr);
        found.TryGetValue("prowlarr", out var prowlarr);
        found.TryGetValue("seerr", out var seerr);
        found.TryGetValue("qbittorrent", out var qbit);

        // 2) Feedarr arr applications (Sonarr / Radarr)
        if (o.RegisterArrApps)
        {
            foreach (var app in new[] { sonarr, radarr })
            {
                if (app is null) continue;
                if (!app.HasApiKey)
                {
                    steps.Add(new AutoSetupStep($"feedarr-{app.Type}", false, $"{app.Name}: nincs API kulcs a config.xml-ben."));
                    continue;
                }
                if (_arrApps.ListByType(app.Type).Any())
                {
                    steps.Add(new AutoSetupStep($"feedarr-{app.Type}", true, $"{app.Name} már be van állítva a Feedarr-ban."));
                    continue;
                }
                var isSonarr = app.Type == "sonarr";
                var id = _arrApps.Create(app.Type, app.Name, Internal(app), app.ApiKey!,
                    rootFolderPath: isSonarr ? o.TvRootFolder : o.MoviesRootFolder,
                    qualityProfileId: null, tags: null,
                    seriesType: isSonarr ? "standard" : null, seasonFolder: true,
                    monitorMode: isSonarr ? "all" : null, searchMissing: true, searchCutoff: false,
                    minimumAvailability: isSonarr ? null : "released", searchForMovie: true);
                _arrApps.SetDefault(id);
                steps.Add(new AutoSetupStep($"feedarr-{app.Type}", true, $"{app.Name} hozzáadva a Feedarr alkalmazásokhoz."));
            }
        }

        // 3) Feedarr indexer provider (Prowlarr)
        if (o.RegisterProwlarr && prowlarr is not null)
        {
            if (!prowlarr.HasApiKey)
            {
                steps.Add(new AutoSetupStep("feedarr-prowlarr", false, "Prowlarr: nincs API kulcs."));
            }
            else
            {
                _providers.UpsertByType("prowlarr", "Prowlarr", Internal(prowlarr), prowlarr.ApiKey!, enabled: true);
                steps.Add(new AutoSetupStep("feedarr-prowlarr", true,
                    "Prowlarr beállítva fournisseur-ként. Az indexereket a Feedarr Indexerek oldalán választhatod ki."));
            }
        }

        // 4) Sonarr / Radarr root folders + qBittorrent download client
        foreach (var app in new[] { sonarr, radarr })
        {
            if (app is null || !app.HasApiKey) continue;
            var isSonarr = app.Type == "sonarr";

            if (o.CreateRootFolders)
            {
                var folder = isSonarr ? o.TvRootFolder : o.MoviesRootFolder;
                steps.Add(await EnsureRootFolderAsync(app, Internal(app), folder, ct).ConfigureAwait(false));
            }

            if (qbit is not null && !string.IsNullOrWhiteSpace(o.QbittorrentUsername) &&
                !string.IsNullOrWhiteSpace(o.QbittorrentPassword))
            {
                steps.Add(await EnsureQbittorrentClientAsync(app, Internal(app), qbit.Port,
                    o.QbittorrentUsername!, o.QbittorrentPassword!, ct).ConfigureAwait(false));
            }
        }
        if (qbit is not null && (string.IsNullOrWhiteSpace(o.QbittorrentUsername) || string.IsNullOrWhiteSpace(o.QbittorrentPassword)))
        {
            steps.Add(new AutoSetupStep("qbittorrent", false,
                "qBittorrent: add meg a WebUI felhasználónevet és jelszót, hogy a Sonarr/Radarr letöltő kliensként használhassa."));
        }

        // 5) Prowlarr → Sonarr / Radarr application sync
        if (o.ProwlarrSyncApps && prowlarr is { HasApiKey: true })
        {
            foreach (var app in new[] { sonarr, radarr })
            {
                if (app is null || !app.HasApiKey) continue;
                steps.Add(await EnsureProwlarrApplicationAsync(prowlarr, Internal(prowlarr), app, Internal(app), ct)
                    .ConfigureAwait(false));
            }
        }

        // 6) Seerr → Sonarr / Radarr servers and → Feedarr webhook
        if (seerr is not null)
        {
            if (!seerr.HasApiKey)
            {
                steps.Add(new AutoSetupStep("seerr", false,
                    "Seerr: nincs API kulcs (settings.json). Indítsd el egyszer a Seerr-t, majd próbáld újra."));
            }
            else
            {
                if (o.SeerrArrServers)
                {
                    if (sonarr is { HasApiKey: true })
                        steps.Add(await EnsureSeerrServerAsync(seerr, Internal(seerr), sonarr, o.TvRootFolder, ct).ConfigureAwait(false));
                    if (radarr is { HasApiKey: true })
                        steps.Add(await EnsureSeerrServerAsync(seerr, Internal(seerr), radarr, o.MoviesRootFolder, ct).ConfigureAwait(false));
                }
                if (o.SeerrWebhook)
                    steps.Add(await ConfigureSeerrWebhookAsync(seerr, Internal(seerr), ct).ConfigureAwait(false));
            }
        }

        return steps;
    }

    private static List<AppLink> OrderLinks(List<AppLink> links)
    {
        var order = AppCatalog.All.Select(a => a.Type).ToList();
        return links
            .OrderBy(l => order.IndexOf(l.Type) is var i && i < 0 ? int.MaxValue : i)
            .ToList();
    }

    // ---------------- Sonarr / Radarr ----------------

    private async Task<AutoSetupStep> EnsureRootFolderAsync(DiscoveredApp app, string baseUrl, string folder, CancellationToken ct)
    {
        var step = $"{app.Type}-rootfolder";
        try
        {
            var existing = await GetJsonArrayAsync($"{baseUrl}/api/v3/rootfolder", app.ApiKey!, ct).ConfigureAwait(false);
            if (existing.Any(r => string.Equals(r?["path"]?.GetValue<string>()?.TrimEnd('/'), folder.TrimEnd('/'), StringComparison.Ordinal)))
                return new AutoSetupStep(step, true, $"{app.Name}: a {folder} gyökérmappa már létezik.");

            var (ok, body) = await PostJsonAsync($"{baseUrl}/api/v3/rootfolder", app.ApiKey!,
                new JsonObject { ["path"] = folder }, ct).ConfigureAwait(false);
            return new AutoSetupStep(step, ok, ok
                ? $"{app.Name}: gyökérmappa hozzáadva ({folder})."
                : $"{app.Name}: a gyökérmappa nem adható hozzá ({folder}): {Short(body)}");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or OperationCanceledException && !ct.IsCancellationRequested)
        {
            return new AutoSetupStep(step, false, $"{app.Name} nem elérhető: {ex.Message}");
        }
    }

    private async Task<AutoSetupStep> EnsureQbittorrentClientAsync(
        DiscoveredApp app, string baseUrl, int qbitPort, string username, string password, CancellationToken ct)
    {
        var step = $"{app.Type}-downloadclient";
        try
        {
            var existing = await GetJsonArrayAsync($"{baseUrl}/api/v3/downloadclient", app.ApiKey!, ct).ConfigureAwait(false);
            if (existing.Any(c => string.Equals(c?["implementation"]?.GetValue<string>(), "QBittorrent", StringComparison.OrdinalIgnoreCase)))
                return new AutoSetupStep(step, true, $"{app.Name}: a qBittorrent letöltő kliens már be van állítva.");

            var schema = await GetJsonArrayAsync($"{baseUrl}/api/v3/downloadclient/schema", app.ApiKey!, ct).ConfigureAwait(false);
            var template = schema.FirstOrDefault(s =>
                string.Equals(s?["implementation"]?.GetValue<string>(), "QBittorrent", StringComparison.OrdinalIgnoreCase));
            if (template is not JsonObject client)
                return new AutoSetupStep(step, false, $"{app.Name}: a qBittorrent séma nem található.");

            client["name"] = "qBittorrent";
            client["enable"] = true;
            client["priority"] = 1;
            SetField(client, "host", "127.0.0.1");
            SetField(client, "port", qbitPort);
            SetField(client, "username", username);
            SetField(client, "password", password);
            SetField(client, app.Type == "sonarr" ? "tvCategory" : "movieCategory", app.Type);

            var (ok, body) = await PostJsonAsync($"{baseUrl}/api/v3/downloadclient", app.ApiKey!, client, ct).ConfigureAwait(false);
            return new AutoSetupStep(step, ok, ok
                ? $"{app.Name}: qBittorrent hozzáadva letöltő kliensként."
                : $"{app.Name}: a qBittorrent nem adható hozzá (rossz jelszó?): {Short(body)}");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException or OperationCanceledException && !ct.IsCancellationRequested)
        {
            return new AutoSetupStep(step, false, $"{app.Name}: {ex.Message}");
        }
    }

    // ---------------- Prowlarr ----------------

    private async Task<AutoSetupStep> EnsureProwlarrApplicationAsync(
        DiscoveredApp prowlarr, string prowlarrUrl, DiscoveredApp app, string appUrl, CancellationToken ct)
    {
        var step = $"prowlarr-{app.Type}";
        var implementation = app.Type == "sonarr" ? "Sonarr" : "Radarr";
        try
        {
            var existing = await GetJsonArrayAsync($"{prowlarrUrl}/api/v1/applications", prowlarr.ApiKey!, ct).ConfigureAwait(false);
            if (existing.Any(a => string.Equals(a?["implementation"]?.GetValue<string>(), implementation, StringComparison.OrdinalIgnoreCase)))
                return new AutoSetupStep(step, true, $"Prowlarr → {implementation} kapcsolat már létezik.");

            var schema = await GetJsonArrayAsync($"{prowlarrUrl}/api/v1/applications/schema", prowlarr.ApiKey!, ct).ConfigureAwait(false);
            if (schema.FirstOrDefault(s => string.Equals(s?["implementation"]?.GetValue<string>(), implementation,
                    StringComparison.OrdinalIgnoreCase)) is not JsonObject application)
            {
                return new AutoSetupStep(step, false, $"Prowlarr: a {implementation} séma nem található.");
            }

            application["name"] = implementation;
            application["syncLevel"] = "fullSync";
            SetField(application, "prowlarrUrl", prowlarrUrl);
            SetField(application, "baseUrl", appUrl);
            SetField(application, "apiKey", app.ApiKey!);

            var (ok, body) = await PostJsonAsync($"{prowlarrUrl}/api/v1/applications", prowlarr.ApiKey!, application, ct)
                .ConfigureAwait(false);
            return new AutoSetupStep(step, ok, ok
                ? $"Prowlarr → {implementation} szinkron beállítva (az indexerek automatikusan átkerülnek)."
                : $"Prowlarr → {implementation} nem sikerült: {Short(body)}");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException or OperationCanceledException && !ct.IsCancellationRequested)
        {
            return new AutoSetupStep(step, false, $"Prowlarr nem elérhető: {ex.Message}");
        }
    }

    // ---------------- Seerr ----------------

    private async Task<AutoSetupStep> EnsureSeerrServerAsync(
        DiscoveredApp seerr, string seerrUrl, DiscoveredApp app, string rootFolder, CancellationToken ct)
    {
        var kind = app.Type; // sonarr | radarr
        var step = $"seerr-{kind}";
        try
        {
            var existing = await GetJsonArrayAsync($"{seerrUrl}/api/v1/settings/{kind}", seerr.ApiKey!, ct).ConfigureAwait(false);
            if (existing.Count > 0)
                return new AutoSetupStep(step, true, $"Seerr: a {app.Name} szerver már be van állítva.");

            var arrUrl = $"http://127.0.0.1:{app.Port}{app.UrlBase ?? ""}";
            var profiles = await GetJsonArrayAsync($"{arrUrl}/api/v3/qualityprofile", app.ApiKey!, ct).ConfigureAwait(false);
            var profile = profiles.FirstOrDefault();
            if (profile is null)
                return new AutoSetupStep(step, false, $"Seerr: a {app.Name}-ban nincs minőségprofil.");

            var body = new JsonObject
            {
                ["name"] = app.Name,
                ["hostname"] = "127.0.0.1",
                ["port"] = app.Port,
                ["apiKey"] = app.ApiKey,
                ["useSsl"] = false,
                ["baseUrl"] = app.UrlBase ?? "",
                ["activeProfileId"] = profile["id"]?.GetValue<int>(),
                ["activeProfileName"] = profile["name"]?.GetValue<string>(),
                ["activeDirectory"] = rootFolder,
                ["is4k"] = false,
                ["isDefault"] = true,
                ["syncEnabled"] = false,
                ["preventSearch"] = false,
                ["tags"] = new JsonArray(),
            };
            if (kind == "sonarr")
            {
                body["enableSeasonFolders"] = true;
                body["seriesType"] = "standard";
                body["animeSeriesType"] = "anime";
                body["activeAnimeProfileId"] = profile["id"]?.GetValue<int>();
                body["activeAnimeProfileName"] = profile["name"]?.GetValue<string>();
                body["activeAnimeDirectory"] = rootFolder;
                body["animeTags"] = new JsonArray();
            }
            else
            {
                body["minimumAvailability"] = "released";
            }

            var (ok, resp) = await PostJsonAsync($"{seerrUrl}/api/v1/settings/{kind}", seerr.ApiKey!, body, ct).ConfigureAwait(false);
            return new AutoSetupStep(step, ok, ok
                ? $"Seerr: {app.Name} szerver hozzáadva (profil: {profile["name"]}, mappa: {rootFolder})."
                : $"Seerr: a {app.Name} szerver nem adható hozzá: {Short(resp)}");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException or FormatException or OperationCanceledException && !ct.IsCancellationRequested)
        {
            return new AutoSetupStep(step, false, $"Seerr / {app.Name}: {ex.Message}");
        }
    }

    /// <summary>Seerr default-compatible payload extended with imdbId (supported by Feedarr).</summary>
    internal const string SeerrWebhookTemplate = """
        {
          "notification_type": "{{notification_type}}",
          "event": "{{event}}",
          "subject": "{{subject}}",
          "message": "{{message}}",
          "image": "{{image}}",
          "{{media}}": {
            "media_type": "{{media_type}}",
            "tmdbId": "{{media_tmdbid}}",
            "tvdbId": "{{media_tvdbid}}",
            "imdbId": "{{media_imdbid}}",
            "status": "{{media_status}}",
            "status4k": "{{media_status4k}}"
          },
          "{{request}}": {
            "request_id": "{{request_id}}",
            "requestedBy_username": "{{requestedBy_username}}"
          },
          "{{extra}}": []
        }
        """;

    private async Task<AutoSetupStep> ConfigureSeerrWebhookAsync(DiscoveredApp seerr, string seerrUrl, CancellationToken ct)
    {
        const string step = "seerr-webhook";
        var feedarrUrl = (_opts.InternalUrl ?? "http://127.0.0.1:8888").TrimEnd('/');
        try
        {
            var current = await GetJsonObjectAsync($"{seerrUrl}/api/v1/settings/notifications/webhook", seerr.ApiKey!, ct)
                .ConfigureAwait(false);
            var currentUrl = current?["options"]?["webhookUrl"]?.GetValue<string>();
            var enabled = current?["enabled"]?.GetValue<bool>() == true;
            if (enabled && !string.IsNullOrWhiteSpace(currentUrl) &&
                !currentUrl.Contains("/api/seerr/webhook", StringComparison.OrdinalIgnoreCase))
            {
                return new AutoSetupStep(step, false,
                    $"Seerr: már van egy másik webhook beállítva ({currentUrl}), ezt nem írom felül.");
            }

            var body = new JsonObject
            {
                ["enabled"] = true,
                ["embedPoster"] = true,
                ["types"] = SeerrTypesMask,
                ["options"] = new JsonObject
                {
                    ["webhookUrl"] = $"{feedarrUrl}/api/seerr/webhook",
                    // Seerr parses this string as JSON and stores it base64 encoded
                    ["jsonPayload"] = SeerrWebhookTemplate,
                    ["authHeader"] = "",
                    ["customHeaders"] = new JsonArray(),
                    ["supportVariables"] = false,
                }
            };

            var (ok, resp) = await PostJsonAsync($"{seerrUrl}/api/v1/settings/notifications/webhook", seerr.ApiKey!, body, ct)
                .ConfigureAwait(false);
            return new AutoSetupStep(step, ok, ok
                ? $"Seerr webhook beállítva → {feedarrUrl}/api/seerr/webhook"
                : $"Seerr webhook beállítása nem sikerült: {Short(resp)}");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException or OperationCanceledException && !ct.IsCancellationRequested)
        {
            return new AutoSetupStep(step, false, $"Seerr nem elérhető: {ex.Message}");
        }
    }

    // ---------------- HTTP helpers ----------------

    private static void SetField(JsonObject resource, string name, JsonNode? value)
    {
        if (resource["fields"] is not JsonArray fields) return;
        foreach (var f in fields)
        {
            if (f is JsonObject field && string.Equals(field["name"]?.GetValue<string>(), name, StringComparison.OrdinalIgnoreCase))
            {
                field["value"] = value;
                return;
            }
        }
    }

    private HttpRequestMessage NewRequest(HttpMethod method, string url, string apiKey)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Add("X-Api-Key", apiKey);
        req.Headers.Accept.ParseAdd("application/json");
        return req;
    }

    private async Task<JsonArray> GetJsonArrayAsync(string url, string apiKey, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient(HttpClientName);
        using var req = NewRequest(HttpMethod.Get, url, apiKey);
        using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"HTTP {(int)resp.StatusCode} ({url})");
        return JsonNode.Parse(body) as JsonArray ?? new JsonArray();
    }

    private async Task<JsonObject?> GetJsonObjectAsync(string url, string apiKey, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient(HttpClientName);
        using var req = NewRequest(HttpMethod.Get, url, apiKey);
        using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"HTTP {(int)resp.StatusCode} ({url})");
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return JsonNode.Parse(body) as JsonObject;
    }

    private async Task<(bool ok, string body)> PostJsonAsync(string url, string apiKey, JsonNode payload, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient(HttpClientName);
        using var req = NewRequest(HttpMethod.Post, url, apiKey);
        req.Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");
        using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
            _log.LogWarning("App hub POST {Url} failed: HTTP {Status} {Body}", url, (int)resp.StatusCode, Short(body));
        return (resp.IsSuccessStatusCode, body);
    }

    private static string Short(string? body)
    {
        var s = (body ?? "").Replace('\n', ' ').Trim();
        return s.Length > 240 ? s[..240] + "…" : s;
    }
}
