using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Feedarr.Api.Data.Repositories;
using Feedarr.Api.Options;
using Microsoft.Extensions.Options;

namespace Feedarr.Api.Services.AppHub;

/// <summary>
/// Backend of the browser "stack setup" wizard (Plex → Radarr → Sonarr → Prowlarr → Seerr →
/// qBittorrent → Tautulli → Poisonarr). Every step talks to the app through its own API
/// (API keys are read from the shared config folders) and is idempotent.
/// </summary>
public sealed class StackSetupService
{
    // NzbDrone.Core.Languages.Language – identical ids in Sonarr / Radarr / Prowlarr
    private const int HungarianLanguageId = 22;
    private const string StackSetupKey = "stack_setup";

    private readonly AppHubService _hub;
    private readonly SettingsRepository _settings;
    private readonly IHttpClientFactory _httpFactory;
    private readonly AppOptions _opts;
    private readonly ILogger<StackSetupService> _log;

    public StackSetupService(
        AppHubService hub,
        SettingsRepository settings,
        IHttpClientFactory httpFactory,
        IOptions<AppOptions> opts,
        ILogger<StackSetupService> log)
    {
        _hub = hub;
        _settings = settings;
        _httpFactory = httpFactory;
        _opts = opts.Value;
        _log = log;
    }

    public bool StackMode => _opts.StackMode;

    // ------------------------------------------------------------------ //
    // Requests / results
    // ------------------------------------------------------------------ //

    public sealed record ArrStepRequest : StepCredentials
    {
        public bool LocalNetworkWithoutLogin { get; init; } = true;
        public string? RootFolder { get; init; }
        public bool HungarianUi { get; init; } = true;
        public bool HungarianMetadata { get; init; } = true;
        public bool AddQbittorrent { get; init; } = true;
    }

    public record StepCredentials
    {
        public string? Username { get; init; }
        public string? Password { get; init; }
    }

    public sealed record ProwlarrStepRequest : StepCredentials
    {
        public bool LocalNetworkWithoutLogin { get; init; } = true;
        public bool HungarianUi { get; init; } = true;
        public bool SyncApps { get; init; } = true;
    }

    public sealed record SeerrStepRequest
    {
        public bool HungarianUi { get; init; } = true;
        public bool ConnectArr { get; init; } = true;
        public bool Webhook { get; init; } = true;
    }

    public sealed record QbittorrentStepRequest : StepCredentials
    {
        public string SavePath { get; init; } = "/srv/media/downloads";
        public string TempPath { get; init; } = "/srv/media/downloads/incomplete";
        public bool HungarianUi { get; init; } = true;
        public bool Categories { get; init; } = true;
        /// <summary>Stop seeding at this ratio (0 = no limit).</summary>
        public double RatioLimit { get; init; }
    }

    public sealed record PlexStepRequest
    {
        /// <summary>One-time code from https://www.plex.tv/claim (valid for 4 minutes).</summary>
        public string? ClaimToken { get; init; }
        public string? ServerName { get; init; }
        public bool CreateLibraries { get; init; } = true;
        public string MoviesPath { get; init; } = "/srv/media/movies";
        public string TvPath { get; init; } = "/srv/media/tv";
        public bool Hungarian { get; init; } = true;
    }

    public sealed record StepResult(string Step, bool Ok, string Message);

    // ------------------------------------------------------------------ //
    // Status
    // ------------------------------------------------------------------ //

    public sealed record AppStatus(
        string Type,
        string Name,
        bool Installed,
        bool Online,
        bool HasApiKey,
        int Port,
        bool Configured,
        IReadOnlyList<string> Details);

    public async Task<object> GetStatusAsync(CancellationToken ct)
    {
        var found = _hub.Discover().ToDictionary(d => d.Type, StringComparer.OrdinalIgnoreCase);
        var apps = new List<AppStatus>();
        foreach (var def in AppCatalog.All)
        {
            found.TryGetValue(def.Type, out var app);
            apps.Add(await GetAppStatusAsync(def, app, ct).ConfigureAwait(false));
        }

        return new
        {
            stackMode = StackMode,
            completed = IsCompleted(),
            configRoot = _hub.ConfigRoot,
            apps
        };
    }

    private async Task<AppStatus> GetAppStatusAsync(AppDefinition def, DiscoveredApp? app, CancellationToken ct)
    {
        if (app is null)
            return new AppStatus(def.Type, def.Name, false, false, false, def.DefaultPort, false, Array.Empty<string>());

        var baseUrl = Local(app);
        var details = new List<string>();
        var online = false;
        var configured = false;

        try
        {
            switch (def.Type)
            {
                case "radarr":
                case "sonarr":
                case "prowlarr":
                {
                    var v = def.Type == "prowlarr" ? "v1" : "v3";
                    if (!app.HasApiKey) break;
                    var host = await GetObjectAsync($"{baseUrl}/api/{v}/config/host", app.ApiKey!, ct).ConfigureAwait(false);
                    online = true;
                    var auth = host?["authenticationMethod"]?.ToString() ?? "none";
                    var authOk = !string.Equals(auth, "none", StringComparison.OrdinalIgnoreCase);
                    details.Add(authOk ? "belépés beállítva" : "nincs belépés beállítva");

                    if (def.Type == "prowlarr")
                    {
                        var apps = await GetArrayAsync($"{baseUrl}/api/v1/applications", app.ApiKey!, ct).ConfigureAwait(false);
                        var indexers = await GetArrayAsync($"{baseUrl}/api/v1/indexer", app.ApiKey!, ct).ConfigureAwait(false);
                        details.Add($"{apps.Count} kapcsolt alkalmazás");
                        details.Add($"{indexers.Count} indexer");
                        configured = authOk && apps.Count > 0;
                    }
                    else
                    {
                        var roots = await GetArrayAsync($"{baseUrl}/api/v3/rootfolder", app.ApiKey!, ct).ConfigureAwait(false);
                        var clients = await GetArrayAsync($"{baseUrl}/api/v3/downloadclient", app.ApiKey!, ct).ConfigureAwait(false);
                        details.Add(roots.Count > 0 ? $"gyökérmappa: {roots[0]?["path"]}" : "nincs gyökérmappa");
                        details.Add(clients.Count > 0 ? $"letöltő kliens: {clients[0]?["name"]}" : "nincs letöltő kliens");
                        configured = authOk && roots.Count > 0 && clients.Count > 0;
                    }
                    break;
                }
                case "seerr":
                {
                    var pub = await GetObjectAsync($"{baseUrl}/api/v1/settings/public", null, ct).ConfigureAwait(false);
                    online = true;
                    var initialized = pub?["initialized"]?.GetValue<bool>() == true;
                    details.Add(initialized ? "kezdeti beállítás kész" : "Plex bejelentkezés még hiányzik");
                    var webhookOk = false;
                    if (app.HasApiKey)
                    {
                        var hook = await TryGetObjectAsync($"{baseUrl}/api/v1/settings/notifications/webhook", app.ApiKey!, ct).ConfigureAwait(false);
                        webhookOk = hook?["enabled"]?.GetValue<bool>() == true &&
                                    (hook?["options"]?["webhookUrl"]?.ToString() ?? "").Contains("/api/seerr/webhook", StringComparison.OrdinalIgnoreCase);
                        details.Add(webhookOk ? "Poisonarr webhook beállítva" : "nincs Poisonarr webhook");
                    }
                    configured = initialized && webhookOk;
                    break;
                }
                case "plex":
                {
                    var identity = await PlexGetAsync($"{baseUrl}/identity", null, ct).ConfigureAwait(false);
                    online = identity is not null;
                    var claimed = PlexClaimed(identity);
                    details.Add(claimed ? "fiókhoz rendelve" : "még nincs a Plex fiókodhoz rendelve");
                    if (claimed)
                    {
                        var sections = await PlexGetAsync($"{baseUrl}/library/sections", app.ApiKey, ct).ConfigureAwait(false);
                        var count = sections?["MediaContainer"]?["Directory"] is JsonArray dirs ? dirs.Count : 0;
                        details.Add(sections is null ? "a könyvtárak nem olvashatók" : $"{count} könyvtár");
                        configured = count > 0;
                    }
                    break;
                }
                case "qbittorrent":
                {
                    var client = _httpFactory.CreateClient(AppHubService.HttpClientName);
                    using var resp = await client.GetAsync($"{baseUrl}/api/v2/app/version", ct).ConfigureAwait(false);
                    online = (int)resp.StatusCode < 500;
                    var bypass = resp.IsSuccessStatusCode;
                    details.Add(bypass ? "helyi API hozzáférés rendben" : "helyi API belépést kér");
                    configured = bypass;
                    break;
                }
                case "tautulli":
                {
                    if (!app.HasApiKey)
                    {
                        var client = _httpFactory.CreateClient(AppHubService.HttpClientName);
                        using var resp = await client.GetAsync($"{baseUrl}/", ct).ConfigureAwait(false);
                        online = (int)resp.StatusCode < 500;
                        details.Add("első indítás varázsló még hiányzik");
                        break;
                    }
                    var info = await GetObjectAsync(
                        $"{baseUrl}/api/v2?apikey={Uri.EscapeDataString(app.ApiKey!)}&cmd=get_server_friendly_name", null, ct).ConfigureAwait(false);
                    online = true;
                    var ok = string.Equals(info?["response"]?["result"]?.ToString(), "success", StringComparison.OrdinalIgnoreCase);
                    var name = info?["response"]?["data"]?.ToString();
                    details.Add(ok && !string.IsNullOrWhiteSpace(name) ? $"Plex szerver: {name}" : "nincs Plex szerver kapcsolat");
                    configured = ok && !string.IsNullOrWhiteSpace(name);
                    break;
                }
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException or InvalidOperationException)
        {
            details.Add("nem elérhető: " + ex.Message);
        }

        return new AppStatus(def.Type, def.Name, true, online, app.HasApiKey, app.Port, configured, details);
    }

    // ------------------------------------------------------------------ //
    // Plex
    // ------------------------------------------------------------------ //

    public async Task<List<StepResult>> SetupPlexAsync(PlexStepRequest req, CancellationToken ct)
    {
        var results = new List<StepResult>();
        var app = Find("plex");
        var def = AppCatalog.Find("plex")!;
        var baseUrl = $"http://127.0.0.1:{app?.Port ?? def.DefaultPort}";

        var identity = await PlexGetAsync($"{baseUrl}/identity", null, ct).ConfigureAwait(false);
        if (identity is null)
        {
            results.Add(new StepResult("plex", false,
                "A Plex Media Server nem érhető el (127.0.0.1:32400). Fut a szolgáltatás? (poisonarr status)"));
            return results;
        }

        // 1) Claim: link the new server to the user's Plex account
        if (!PlexClaimed(identity))
        {
            var claim = (req.ClaimToken ?? "").Trim();
            if (!claim.StartsWith("claim-", StringComparison.Ordinal))
            {
                results.Add(new StepResult("plex-claim", false,
                    "Add meg a claim kódot a https://www.plex.tv/claim oldalról (claim-… kezdetű, 4 percig érvényes)."));
                return results;
            }

            var (status, body) = await PlexSendAsync(HttpMethod.Post,
                $"{baseUrl}/myplex/claim?token={Uri.EscapeDataString(claim)}", null, ct).ConfigureAwait(false);
            var claimed = false;
            for (var i = 0; i < 15 && !claimed; i++)
            {
                await Task.Delay(TimeSpan.FromSeconds(1), ct).ConfigureAwait(false);
                claimed = PlexClaimed(await PlexGetAsync($"{baseUrl}/identity", null, ct).ConfigureAwait(false));
            }
            if (!claimed)
            {
                results.Add(new StepResult("plex-claim", false,
                    $"A Plex szerver hozzárendelése nem sikerült (HTTP {status}: {Short(body)}). Lehet, hogy lejárt a kód – kérj újat, " +
                    "vagy nyisd meg a http://<ip>:32400/web oldalt és jelentkezz be ott."));
                return results;
            }
            results.Add(new StepResult("plex-claim", true, "A Plex szerver a fiókodhoz rendelve."));
        }
        else
        {
            results.Add(new StepResult("plex-claim", true, "A Plex szerver már a fiókodhoz van rendelve."));
        }

        // 2) Token: Plex writes it to Preferences.xml after the claim (the installer also allows
        //    token-less API calls from localhost, so a missing token is not fatal).
        string? token = null;
        for (var i = 0; i < 10 && token is null; i++)
        {
            token = Find("plex")?.ApiKey;
            if (token is null) await Task.Delay(TimeSpan.FromSeconds(1), ct).ConfigureAwait(false);
        }

        var sections = await PlexGetAsync($"{baseUrl}/library/sections", token, ct).ConfigureAwait(false);
        if (sections is null)
        {
            results.Add(new StepResult("plex-api", false,
                "A Plex API nem engedi a hozzáférést. Futtasd újra a telepítőt (beállítja a helyi hozzáférést), " +
                "vagy hozd létre a könyvtárakat a Plexben kézzel."));
            return results;
        }

        // 3) Server name
        var name = (req.ServerName ?? "").Trim();
        if (name.Length > 0)
        {
            var (st, _) = await PlexSendAsync(HttpMethod.Put,
                $"{baseUrl}/:/prefs?FriendlyName={Uri.EscapeDataString(name)}", token, ct).ConfigureAwait(false);
            var ok = st is >= 200 and < 300;
            results.Add(new StepResult("plex-name", ok, ok ? $"Szerver neve: {name}" : $"A szerver neve nem állítható be (HTTP {st})."));
        }

        // 4) Libraries (Movies / TV) on the shared media folders
        if (req.CreateLibraries)
        {
            var existing = new List<(string Type, string Path)>();
            if (sections["MediaContainer"]?["Directory"] is JsonArray dirs)
            {
                foreach (var d in dirs)
                {
                    var t = d?["type"]?.ToString() ?? "";
                    if (d?["Location"] is not JsonArray locs) continue;
                    foreach (var l in locs) existing.Add((t, (l?["path"]?.ToString() ?? "").TrimEnd('/')));
                }
            }

            var language = req.Hungarian ? "hu-HU" : "en-US";
            var libs = new[]
            {
                (Type: "movie", Name: req.Hungarian ? "Filmek" : "Movies", Path: req.MoviesPath,
                    Agent: "tv.plex.agents.movie", Scanner: "Plex Movie"),
                (Type: "show", Name: req.Hungarian ? "Sorozatok" : "TV Shows", Path: req.TvPath,
                    Agent: "tv.plex.agents.series", Scanner: "Plex TV Series"),
            };
            foreach (var lib in libs)
            {
                var path = (lib.Path ?? "").Trim().TrimEnd('/');
                if (path.Length == 0) continue;
                if (existing.Any(e => e.Type == lib.Type && string.Equals(e.Path, path, StringComparison.Ordinal)))
                {
                    results.Add(new StepResult($"plex-{lib.Type}", true, $"„{lib.Name}” könyvtár már létezik ({path})."));
                    continue;
                }
                var url = $"{baseUrl}/library/sections?name={Uri.EscapeDataString(lib.Name)}&type={lib.Type}" +
                          $"&agent={Uri.EscapeDataString(lib.Agent)}&scanner={Uri.EscapeDataString(lib.Scanner)}" +
                          $"&language={language}&location={Uri.EscapeDataString(path)}";
                var (st, body) = await PlexSendAsync(HttpMethod.Post, url, token, ct).ConfigureAwait(false);
                var ok = st is >= 200 and < 300;
                results.Add(new StepResult($"plex-{lib.Type}", ok, ok
                    ? $"„{lib.Name}” könyvtár létrehozva: {path}" + (req.Hungarian ? " (magyar metaadatok)" : "")
                    : $"A(z) „{lib.Name}” könyvtár nem jött létre (HTTP {st}: {Short(body)})."));
            }
        }

        // 5) Sidebar link (Plex Web opens in a new tab)
        var links = await _hub.AutoSetupAsync(new AutoSetupOptions
        {
            CreateLinks = true, RegisterArrApps = false, RegisterProwlarr = false, ProwlarrSyncApps = false,
            SeerrWebhook = false, SeerrArrServers = false, CreateRootFolders = false,
        }, ct, onlyTypes: new[] { "plex" }).ConfigureAwait(false);
        results.AddRange(links.Where(s => s.Step == "links").Select(s => new StepResult(s.Step, s.Ok, s.Message)));
        return results;
    }

    internal static bool PlexClaimed(JsonObject? identity)
    {
        var v = identity?["MediaContainer"]?["claimed"];
        if (v is null) return false;
        return v.GetValueKind() switch
        {
            JsonValueKind.True => true,
            JsonValueKind.String => v.ToString() is "1" or "true",
            JsonValueKind.Number => v.GetValue<int>() == 1,
            _ => false
        };
    }

    private static HttpRequestMessage PlexRequest(HttpMethod method, string url, string? token)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Accept.ParseAdd("application/json");
        req.Headers.Add("X-Plex-Product", "Poisonarr");
        req.Headers.Add("X-Plex-Version", "2.6");
        req.Headers.Add("X-Plex-Client-Identifier", "poisonarr-stack-setup");
        req.Headers.Add("X-Plex-Platform", "Linux");
        req.Headers.Add("X-Plex-Device-Name", "Poisonarr");
        if (!string.IsNullOrWhiteSpace(token)) req.Headers.Add("X-Plex-Token", token);
        return req;
    }

    /// <summary>GET a Plex JSON endpoint; null when unreachable or not authorised.</summary>
    private async Task<JsonObject?> PlexGetAsync(string url, string? token, CancellationToken ct)
    {
        try
        {
            var client = _httpFactory.CreateClient(AppHubService.HttpClientName);
            using var req = PlexRequest(HttpMethod.Get, url, token);
            using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            return JsonNode.Parse(body) as JsonObject;
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            _log.LogDebug(ex, "Plex request failed: {Url}", url.Split('?')[0]);
            return null;
        }
    }

    private async Task<(int Status, string Body)> PlexSendAsync(HttpMethod method, string url, string? token, CancellationToken ct)
    {
        try
        {
            var client = _httpFactory.CreateClient(AppHubService.HttpClientName);
            using var req = PlexRequest(method, url, token);
            using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
                _log.LogWarning("Plex {Method} {Url} failed: HTTP {Status}", method, url.Split('?')[0], (int)resp.StatusCode);
            return ((int)resp.StatusCode, body);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return (0, ex.Message);
        }
    }

    // ------------------------------------------------------------------ //
    // Radarr / Sonarr
    // ------------------------------------------------------------------ //

    public async Task<List<StepResult>> SetupArrAsync(string type, ArrStepRequest req, CancellationToken ct)
    {
        var results = new List<StepResult>();
        var app = Find(type);
        if (app is null || !app.HasApiKey)
        {
            results.Add(new StepResult(type, false, $"{Title(type)}: nem található a konfiguráció vagy az API kulcs. Fut a szolgáltatás?"));
            return results;
        }

        var baseUrl = Local(app);
        results.Add(await SetAuthenticationAsync(app, baseUrl, "v3", req.Username, req.Password, req.LocalNetworkWithoutLogin, ct).ConfigureAwait(false));

        if (req.HungarianUi || (type == "radarr" && req.HungarianMetadata))
            results.Add(await SetUiLanguageAsync(app, baseUrl, "v3", req.HungarianUi,
                type == "radarr" && req.HungarianMetadata, ct).ConfigureAwait(false));

        var root = string.IsNullOrWhiteSpace(req.RootFolder)
            ? (type == "sonarr" ? "/srv/media/tv" : "/srv/media/movies")
            : req.RootFolder!.Trim();

        var auto = new AutoSetupOptions
        {
            CreateLinks = false,
            RegisterArrApps = false,
            RegisterProwlarr = false,
            ProwlarrSyncApps = false,
            SeerrWebhook = false,
            SeerrArrServers = false,
            CreateRootFolders = true,
            TvRootFolder = root,
            MoviesRootFolder = root,
            QbittorrentUsername = req.AddQbittorrent ? req.Username : null,
            QbittorrentPassword = req.AddQbittorrent ? req.Password : null,
        };
        var steps = await _hub.AutoSetupAsync(auto, ct, onlyTypes: new[] { type, "qbittorrent" }).ConfigureAwait(false);
        results.AddRange(steps
            .Where(s => s.Step.StartsWith(type, StringComparison.OrdinalIgnoreCase) ||
                        (req.AddQbittorrent && s.Step == "qbittorrent"))
            .Select(s => new StepResult(s.Step, s.Ok, s.Message)));

        // Register in Feedarr (arr applications)
        var reg = await _hub.AutoSetupAsync(new AutoSetupOptions
        {
            CreateLinks = true,
            RegisterArrApps = true,
            RegisterProwlarr = false,
            ProwlarrSyncApps = false,
            SeerrWebhook = false,
            SeerrArrServers = false,
            CreateRootFolders = false,
            TvRootFolder = root,
            MoviesRootFolder = root,
        }, ct, onlyTypes: new[] { type }).ConfigureAwait(false);
        results.AddRange(reg.Where(s => s.Step.StartsWith("feedarr-", StringComparison.Ordinal))
            .Select(s => new StepResult(s.Step, s.Ok, s.Message)));

        return results;
    }

    // ------------------------------------------------------------------ //
    // Prowlarr
    // ------------------------------------------------------------------ //

    public async Task<List<StepResult>> SetupProwlarrAsync(ProwlarrStepRequest req, CancellationToken ct)
    {
        var results = new List<StepResult>();
        var app = Find("prowlarr");
        if (app is null || !app.HasApiKey)
        {
            results.Add(new StepResult("prowlarr", false, "Prowlarr: nem található a konfiguráció vagy az API kulcs."));
            return results;
        }

        var baseUrl = Local(app);
        results.Add(await SetAuthenticationAsync(app, baseUrl, "v1", req.Username, req.Password, req.LocalNetworkWithoutLogin, ct).ConfigureAwait(false));
        if (req.HungarianUi)
            results.Add(await SetUiLanguageAsync(app, baseUrl, "v1", true, false, ct).ConfigureAwait(false));

        var steps = await _hub.AutoSetupAsync(new AutoSetupOptions
        {
            CreateLinks = true,
            RegisterArrApps = false,
            RegisterProwlarr = true,
            ProwlarrSyncApps = req.SyncApps,
            SeerrWebhook = false,
            SeerrArrServers = false,
            CreateRootFolders = false,
        }, ct, onlyTypes: new[] { "prowlarr", "sonarr", "radarr" }).ConfigureAwait(false);
        results.AddRange(steps
            .Where(s => s.Step.StartsWith("prowlarr", StringComparison.Ordinal) || s.Step == "feedarr-prowlarr")
            .Select(s => new StepResult(s.Step, s.Ok, s.Message)));
        return results;
    }

    // ------------------------------------------------------------------ //
    // Seerr
    // ------------------------------------------------------------------ //

    public async Task<List<StepResult>> SetupSeerrAsync(SeerrStepRequest req, CancellationToken ct)
    {
        var results = new List<StepResult>();
        var app = Find("seerr");
        if (app is null || !app.HasApiKey)
        {
            results.Add(new StepResult("seerr", false, "Seerr: nem található a settings.json / API kulcs. Indítsd el egyszer a Seerr-t."));
            return results;
        }

        var baseUrl = Local(app);
        var pub = await TryGetObjectAsync($"{baseUrl}/api/v1/settings/public", null, ct).ConfigureAwait(false);
        if (pub?["initialized"]?.GetValue<bool>() != true)
        {
            results.Add(new StepResult("seerr-init", false,
                "A Seerr kezdeti beállítása még nincs kész: jelentkezz be a Plex fiókoddal, válaszd ki a szervert és a könyvtárakat (a Sonarr/Radarr lépést kihagyhatod), majd próbáld újra."));
            return results;
        }

        if (req.HungarianUi)
        {
            var (ok, body) = await SendAsync(HttpMethod.Post, $"{baseUrl}/api/v1/settings/main", app.ApiKey,
                new JsonObject { ["locale"] = "hu" }, ct).ConfigureAwait(false);
            results.Add(new StepResult("seerr-locale", ok, ok ? "Seerr nyelve: magyar." : $"Seerr nyelv beállítása nem sikerült: {Short(body)}"));
        }

        var steps = await _hub.AutoSetupAsync(new AutoSetupOptions
        {
            CreateLinks = true,
            RegisterArrApps = false,
            RegisterProwlarr = false,
            ProwlarrSyncApps = false,
            SeerrWebhook = req.Webhook,
            SeerrArrServers = req.ConnectArr,
            CreateRootFolders = false,
        }, ct, onlyTypes: new[] { "seerr", "sonarr", "radarr" }).ConfigureAwait(false);
        results.AddRange(steps.Where(s => s.Step.StartsWith("seerr", StringComparison.Ordinal))
            .Select(s => new StepResult(s.Step, s.Ok, s.Message)));
        return results;
    }

    // ------------------------------------------------------------------ //
    // qBittorrent
    // ------------------------------------------------------------------ //

    public async Task<List<StepResult>> SetupQbittorrentAsync(QbittorrentStepRequest req, CancellationToken ct)
    {
        var results = new List<StepResult>();
        var app = Find("qbittorrent");
        if (app is null)
        {
            results.Add(new StepResult("qbittorrent", false, "qBittorrent: nem található a konfiguráció."));
            return results;
        }

        var baseUrl = Local(app);
        var cookie = await QbitAuthenticateAsync(baseUrl, req.Username, req.Password, ct).ConfigureAwait(false);
        if (cookie is null)
        {
            results.Add(new StepResult("qbittorrent-auth", false,
                "qBittorrent: nem sikerült hozzáférni a WebUI API-hoz. Add meg a jelenlegi qBittorrent jelszót (feedarr-stack credentials), vagy engedélyezd a helyi hozzáférést."));
            return results;
        }

        var prefs = new JsonObject
        {
            ["save_path"] = req.SavePath,
            ["temp_path_enabled"] = !string.IsNullOrWhiteSpace(req.TempPath),
            ["temp_path"] = req.TempPath,
            ["web_ui_clickjacking_protection_enabled"] = false,
            ["web_ui_host_header_validation_enabled"] = false,
            ["bypass_local_auth"] = true,
        };
        if (!string.IsNullOrWhiteSpace(req.Username)) prefs["web_ui_username"] = req.Username!.Trim();
        if (!string.IsNullOrWhiteSpace(req.Password)) prefs["web_ui_password"] = req.Password;
        if (req.HungarianUi) prefs["locale"] = "hu";
        if (req.RatioLimit > 0)
        {
            prefs["max_ratio_enabled"] = true;
            prefs["max_ratio"] = req.RatioLimit;
        }

        var (ok, body) = await QbitPostFormAsync(baseUrl, "/api/v2/app/setPreferences", cookie,
            new Dictionary<string, string> { ["json"] = prefs.ToJsonString() }, ct).ConfigureAwait(false);
        results.Add(new StepResult("qbittorrent-prefs", ok, ok
            ? $"qBittorrent beállítva: mentés ide {req.SavePath}" +
              (string.IsNullOrWhiteSpace(req.Username) ? "" : $", felhasználó: {req.Username}") +
              (req.HungarianUi ? ", magyar felület" : "")
            : $"qBittorrent beállítás nem sikerült: {Short(body)}"));

        if (ok && req.Categories)
        {
            foreach (var cat in new[] { "radarr", "sonarr" })
            {
                var path = $"{req.SavePath.TrimEnd('/')}/{cat}";
                var (cok, cbody) = await QbitPostFormAsync(baseUrl, "/api/v2/torrents/createCategory", cookie,
                    new Dictionary<string, string> { ["category"] = cat, ["savePath"] = path }, ct).ConfigureAwait(false);
                // 409 = already exists
                var exists = cbody.Contains("409", StringComparison.Ordinal) || cbody.Contains("exist", StringComparison.OrdinalIgnoreCase);
                results.Add(new StepResult($"qbittorrent-category-{cat}", cok || exists,
                    cok ? $"Kategória: {cat} → {path}" : exists ? $"A(z) {cat} kategória már létezik." : $"Kategória hiba ({cat}): {Short(cbody)}"));
            }
        }

        return results;
    }

    private async Task<string?> QbitAuthenticateAsync(string baseUrl, string? username, string? password, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient(AppHubService.HttpClientName);
        using (var probe = await client.GetAsync($"{baseUrl}/api/v2/app/version", ct).ConfigureAwait(false))
        {
            if (probe.IsSuccessStatusCode) return ""; // localhost bypass: no cookie needed
        }

        var candidates = new List<(string u, string p)>();
        if (!string.IsNullOrWhiteSpace(username) && !string.IsNullOrWhiteSpace(password))
            candidates.Add((username!.Trim(), password!));
        candidates.AddRange(ReadInstallerQbitCredentials());

        foreach (var (u, p) in candidates)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/api/v2/auth/login")
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["username"] = u, ["password"] = p })
            };
            req.Headers.Referrer = new Uri(baseUrl);
            using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode || !body.Contains("Ok", StringComparison.OrdinalIgnoreCase)) continue;
            if (resp.Headers.TryGetValues("Set-Cookie", out var cookies))
            {
                var sid = cookies.Select(c => c.Split(';')[0]).FirstOrDefault(c => c.StartsWith("SID=", StringComparison.Ordinal));
                if (sid is not null) return sid;
            }
        }
        return null;
    }

    /// <summary>The installer stores the generated qBittorrent login here (readable by the media user only).</summary>
    private IEnumerable<(string, string)> ReadInstallerQbitCredentials()
    {
        var file = Path.Combine(_opts.AppConfigRoot, "feedarr-stack", "qbittorrent.json");
        try
        {
            if (!File.Exists(file)) return Array.Empty<(string, string)>();
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            var u = doc.RootElement.GetProperty("username").GetString();
            var p = doc.RootElement.GetProperty("password").GetString();
            return string.IsNullOrWhiteSpace(u) || string.IsNullOrWhiteSpace(p)
                ? Array.Empty<(string, string)>()
                : new[] { (u!, p!) };
        }
        catch (Exception ex) when (ex is IOException or JsonException or KeyNotFoundException or UnauthorizedAccessException)
        {
            _log.LogDebug(ex, "qBittorrent installer credentials not readable");
            return Array.Empty<(string, string)>();
        }
    }

    private async Task<(bool ok, string body)> QbitPostFormAsync(
        string baseUrl, string path, string cookie, Dictionary<string, string> form, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient(AppHubService.HttpClientName);
        using var req = new HttpRequestMessage(HttpMethod.Post, baseUrl + path) { Content = new FormUrlEncodedContent(form) };
        req.Headers.Referrer = new Uri(baseUrl);
        if (!string.IsNullOrEmpty(cookie)) req.Headers.Add("Cookie", cookie);
        using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return (resp.IsSuccessStatusCode, resp.IsSuccessStatusCode ? body : $"HTTP {(int)resp.StatusCode} {body}");
    }

    // ------------------------------------------------------------------ //
    // Tautulli
    // ------------------------------------------------------------------ //

    public async Task<List<StepResult>> CheckTautulliAsync(CancellationToken ct)
    {
        var def = AppCatalog.Find("tautulli")!;
        var status = await GetAppStatusAsync(def, Find("tautulli"), ct).ConfigureAwait(false);
        var results = new List<StepResult>
        {
            new("tautulli", status.Configured, status.Configured
                ? "Tautulli kapcsolódik a Plex szerverhez: " + string.Join(", ", status.Details)
                : "Tautulli még nincs a Plexhez kötve: " + string.Join(", ", status.Details))
        };
        var links = await _hub.AutoSetupAsync(new AutoSetupOptions
        {
            CreateLinks = true, RegisterArrApps = false, RegisterProwlarr = false, ProwlarrSyncApps = false,
            SeerrWebhook = false, SeerrArrServers = false, CreateRootFolders = false,
        }, ct, onlyTypes: new[] { "tautulli", "qbittorrent" }).ConfigureAwait(false);
        results.AddRange(links.Where(s => s.Step == "links").Select(s => new StepResult(s.Step, s.Ok, s.Message)));
        return results;
    }

    // ------------------------------------------------------------------ //
    // Feedarr (final)
    // ------------------------------------------------------------------ //

    public async Task<List<StepResult>> FinishAsync(CancellationToken ct)
    {
        var steps = await _hub.AutoSetupAsync(new AutoSetupOptions
        {
            CreateLinks = true,
            RegisterArrApps = true,
            RegisterProwlarr = true,
            ProwlarrSyncApps = false,
            SeerrWebhook = false,
            SeerrArrServers = false,
            CreateRootFolders = false,
        }, ct).ConfigureAwait(false);

        MarkCompleted();
        var results = steps
            .Where(s => s.Step is "links" or "discover" || s.Step.StartsWith("feedarr-", StringComparison.Ordinal))
            .Select(s => new StepResult(s.Step, s.Ok, s.Message))
            .ToList();
        results.Add(new StepResult("stack", true, "Az alkalmazások beállítása kész."));
        return results;
    }

    public bool IsCompleted()
    {
        try
        {
            return _settings.GetJsonFlag(StackSetupKey);
        }
        catch
        {
            return false;
        }
    }

    public void MarkCompleted() => _settings.SetJsonFlag(StackSetupKey, true);

    // ------------------------------------------------------------------ //
    // Shared helpers for *arr apps
    // ------------------------------------------------------------------ //

    private async Task<StepResult> SetAuthenticationAsync(
        DiscoveredApp app, string baseUrl, string apiVersion, string? username, string? password,
        bool localWithoutLogin, CancellationToken ct)
    {
        var step = $"{app.Type}-auth";
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            return new StepResult(step, false, $"{app.Name}: hiányzik a felhasználónév vagy a jelszó.");

        try
        {
            var host = await GetObjectAsync($"{baseUrl}/api/{apiVersion}/config/host", app.ApiKey!, ct).ConfigureAwait(false)
                       ?? throw new InvalidOperationException("üres válasz");
            host["authenticationMethod"] = "forms";
            host["authenticationRequired"] = localWithoutLogin ? "disabledForLocalAddresses" : "enabled";
            host["username"] = username.Trim();
            host["password"] = password;
            host["passwordConfirmation"] = password;

            var id = host["id"]?.GetValue<int>() ?? 1;
            var (ok, body) = await SendAsync(HttpMethod.Put, $"{baseUrl}/api/{apiVersion}/config/host/{id}", app.ApiKey, host, ct)
                .ConfigureAwait(false);
            return new StepResult(step, ok, ok
                ? $"{app.Name}: belépés beállítva ({username.Trim()}" + (localWithoutLogin ? ", helyi hálózatról jelszó nélkül)." : ").")
                : $"{app.Name}: a belépés beállítása nem sikerült: {Short(body)}");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException or TaskCanceledException)
        {
            return new StepResult(step, false, $"{app.Name} nem elérhető: {ex.Message}");
        }
    }

    private async Task<StepResult> SetUiLanguageAsync(
        DiscoveredApp app, string baseUrl, string apiVersion, bool ui, bool metadata, CancellationToken ct)
    {
        var step = $"{app.Type}-language";
        try
        {
            var cfg = await GetObjectAsync($"{baseUrl}/api/{apiVersion}/config/ui", app.ApiKey!, ct).ConfigureAwait(false)
                      ?? throw new InvalidOperationException("üres válasz");
            var huId = await FindHungarianLanguageIdAsync(baseUrl, apiVersion, app.ApiKey!, ct).ConfigureAwait(false);
            var changed = new List<string>();
            if (ui && cfg.ContainsKey("uiLanguage")) { cfg["uiLanguage"] = huId; changed.Add("felület"); }
            if (metadata && cfg.ContainsKey("movieInfoLanguage")) { cfg["movieInfoLanguage"] = huId; changed.Add("film adatok"); }
            if (changed.Count == 0)
                return new StepResult(step, true, $"{app.Name}: nyelvi beállítás nem érhető el ebben a verzióban.");

            var id = cfg["id"]?.GetValue<int>() ?? 1;
            var (ok, body) = await SendAsync(HttpMethod.Put, $"{baseUrl}/api/{apiVersion}/config/ui/{id}", app.ApiKey, cfg, ct)
                .ConfigureAwait(false);
            return new StepResult(step, ok, ok
                ? $"{app.Name}: magyar nyelv ({string.Join(", ", changed)})."
                : $"{app.Name}: a nyelv beállítása nem sikerült: {Short(body)}");
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException or TaskCanceledException)
        {
            return new StepResult(step, false, $"{app.Name}: a nyelv beállítása nem sikerült: {ex.Message}");
        }
    }

    private async Task<int> FindHungarianLanguageIdAsync(string baseUrl, string apiVersion, string apiKey, CancellationToken ct)
    {
        try
        {
            var list = await GetArrayAsync($"{baseUrl}/api/{apiVersion}/language", apiKey, ct).ConfigureAwait(false);
            foreach (var item in list)
            {
                if (string.Equals(item?["name"]?.ToString(), "Hungarian", StringComparison.OrdinalIgnoreCase) &&
                    item?["id"] is JsonValue v && v.TryGetValue<int>(out var id))
                {
                    return id;
                }
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException)
        {
            _log.LogDebug(ex, "Language list not available at {Url}", baseUrl);
        }
        return HungarianLanguageId;
    }

    private DiscoveredApp? Find(string type)
        => _hub.Discover().FirstOrDefault(a => string.Equals(a.Type, type, StringComparison.OrdinalIgnoreCase));

    private static string Local(DiscoveredApp a) => $"http://127.0.0.1:{a.Port}{a.UrlBase ?? ""}";

    private static string Title(string type) => AppCatalog.Find(type)?.Name ?? type;

    private async Task<JsonObject?> GetObjectAsync(string url, string? apiKey, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient(AppHubService.HttpClientName);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (!string.IsNullOrWhiteSpace(apiKey)) req.Headers.Add("X-Api-Key", apiKey);
        req.Headers.Accept.ParseAdd("application/json");
        using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode) throw new HttpRequestException($"HTTP {(int)resp.StatusCode}");
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return JsonNode.Parse(body) as JsonObject;
    }

    private async Task<JsonObject?> TryGetObjectAsync(string url, string? apiKey, CancellationToken ct)
    {
        try
        {
            return await GetObjectAsync(url, apiKey, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            return null;
        }
    }

    private async Task<JsonArray> GetArrayAsync(string url, string apiKey, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient(AppHubService.HttpClientName);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Add("X-Api-Key", apiKey);
        req.Headers.Accept.ParseAdd("application/json");
        using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode) throw new HttpRequestException($"HTTP {(int)resp.StatusCode}");
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return JsonNode.Parse(body) as JsonArray ?? new JsonArray();
    }

    private async Task<(bool ok, string body)> SendAsync(HttpMethod method, string url, string? apiKey, JsonNode payload, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient(AppHubService.HttpClientName);
        using var req = new HttpRequestMessage(method, url)
        {
            Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json")
        };
        if (!string.IsNullOrWhiteSpace(apiKey)) req.Headers.Add("X-Api-Key", apiKey);
        using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
            _log.LogWarning("Stack setup {Method} {Url} failed: HTTP {Status} {Body}", method, url, (int)resp.StatusCode, Short(body));
        return (resp.IsSuccessStatusCode, body);
    }

    private static string Short(string? body)
    {
        var s = (body ?? "").Replace('\n', ' ').Trim();
        return s.Length > 240 ? s[..240] + "…" : s;
    }
}
