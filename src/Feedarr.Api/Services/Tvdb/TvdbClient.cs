using System.Text.Json;
using System.Text.Json.Serialization;
using Feedarr.Api.Services.ExternalProviders;

namespace Feedarr.Api.Services.Tvdb;

/// <summary>
/// Client for TheTVDB v4 API.
/// Provides series metadata: network, status, episode counts, alternate titles.
/// Authentication: POST /login with apikey + optional subscriber PIN.
/// Token TTL: 30 days — cached in memory with automatic refresh.
/// API docs: https://thetvdb.github.io/v4-api/
/// </summary>
public sealed class TvdbClient
{
    public sealed record SeriesInfo(
        int     TvdbId,
        string? Name,
        string? NameHu,
        string? Overview,
        string? Network,
        string? Status,       // "Continuing" | "Ended" | "Upcoming"
        string? FirstAired,
        float?  Score);

    private readonly HttpClient _http;
    private readonly ActiveExternalProviderConfigResolver _config;
    private readonly ILogger<TvdbClient> _log;

    private const string BaseUrl = "https://api4.thetvdb.com/v4/";

    // In-memory token cache (token + expiry + credentials fingerprint).
    // Static because typed HttpClient consumers are registered as transient:
    // an instance field would force a new /login for every resolved instance.
    private static string? _cachedToken;
    private static string? _cachedTokenCredentials;
    private static DateTimeOffset _tokenExpiry = DateTimeOffset.MinValue;
    private static readonly SemaphoreSlim _tokenLock = new(1, 1);

    public TvdbClient(
        HttpClient http,
        ActiveExternalProviderConfigResolver config,
        ILogger<TvdbClient> log)
    {
        _http   = http;
        _config = config;
        _log    = log;
    }

    // ------------------------------------------------------------------ //
    // Public API
    // ------------------------------------------------------------------ //

    /// <summary>
    /// Gets series info by TheTVDB ID including Hungarian alternative title.
    /// </summary>
    public async Task<SeriesInfo?> GetSeriesAsync(int tvdbId, CancellationToken ct)
    {
        if (tvdbId <= 0) return null;
        var token = await EnsureTokenAsync(ct).ConfigureAwait(false);
        if (token is null) return null;

        try
        {
            // Extended record includes translations
            var url = $"{BaseUrl}series/{tvdbId}/extended?meta=translations&short=false";
            var req = BuildRequest(HttpMethod.Get, url, token);
            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return null;

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var r = JsonSerializer.Deserialize<TvdbSeriesExtendedEnvelope>(body);
            var d = r?.Data;
            if (d is null) return null;

            // Hungarian name from translations
            var nameHu = d.Translations?.NameTranslations
                ?.FirstOrDefault(t => string.Equals(t.Language, "hun", StringComparison.OrdinalIgnoreCase))
                ?.Name;

            // Network: prefer primary company of type "Network"
            var network = d.Companies
                ?.Where(c => string.Equals(c.CompanyType?.CompanyTypeName, "Network", StringComparison.OrdinalIgnoreCase))
                .Select(c => c.Name)
                .FirstOrDefault();

            return new SeriesInfo(
                TvdbId:     tvdbId,
                Name:       d.Name,
                NameHu:     nameHu,
                Overview:   d.Overview,
                Network:    network,
                Status:     d.Status?.Name,
                FirstAired: d.FirstAired,
                Score:      d.Score > 0 ? d.Score : null);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "TheTVDB GetSeriesAsync failed for tvdbId={TvdbId}", tvdbId);
            return null;
        }
    }

    /// <summary>
    /// Tests an API key (and optional PIN) by calling /login. When no key is supplied,
    /// the stored provider configuration is used. The token cache is not touched.
    /// </summary>
    public async Task<(bool ok, string? error)> TestConnectionAsync(CancellationToken ct)
        => await TestConnectionAsync(null, null, ct).ConfigureAwait(false);

    public async Task<(bool ok, string? error)> TestConnectionAsync(string? apiKey, string? pin, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            var auth = _config.Resolve(ExternalProviderKeys.Tvdb).Auth;
            auth.TryGetValue("apiKey", out apiKey);
            auth.TryGetValue("pin", out pin);
        }

        if (string.IsNullOrWhiteSpace(apiKey))
            return (false, "TheTVDB API key not configured.");

        var token = await LoginAsync(apiKey.Trim(), pin?.Trim(), ct).ConfigureAwait(false);
        return token is not null
            ? (true, null)
            : (false, "TheTVDB login failed — check API key and PIN.");
    }

    // ------------------------------------------------------------------ //
    // Token management
    // ------------------------------------------------------------------ //

    private async Task<string?> EnsureTokenAsync(CancellationToken ct)
    {
        var config = _config.Resolve(ExternalProviderKeys.Tvdb);
        if (!config.Enabled) return null;
        config.Auth.TryGetValue("apiKey", out var apiKey);
        if (string.IsNullOrWhiteSpace(apiKey)) return null;
        config.Auth.TryGetValue("pin", out var pin);
        apiKey = apiKey.Trim();
        pin = pin?.Trim();
        var credentials = apiKey + "\n" + (pin ?? "");

        if (IsCachedTokenValid(credentials))
            return _cachedToken;

        await _tokenLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            // Double-check after acquiring lock
            if (IsCachedTokenValid(credentials))
                return _cachedToken;

            var tok = await LoginAsync(apiKey, pin, ct).ConfigureAwait(false);
            if (tok is null) return null;

            _cachedToken = tok;
            _cachedTokenCredentials = credentials;
            _tokenExpiry = DateTimeOffset.UtcNow.AddDays(28); // 30d TTL, refresh 2d early
            return _cachedToken;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    private static bool IsCachedTokenValid(string credentials)
        => _cachedToken is not null &&
           string.Equals(_cachedTokenCredentials, credentials, StringComparison.Ordinal) &&
           DateTimeOffset.UtcNow < _tokenExpiry;

    private async Task<string?> LoginAsync(string apiKey, string? pin, CancellationToken ct)
    {
        try
        {
            var loginBody = string.IsNullOrWhiteSpace(pin)
                ? JsonSerializer.Serialize(new Dictionary<string, string> { ["apikey"] = apiKey })
                : JsonSerializer.Serialize(new Dictionary<string, string> { ["apikey"] = apiKey, ["pin"] = pin });

            using var req = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}login")
            {
                Content = new StringContent(loginBody, System.Text.Encoding.UTF8, "application/json")
            };

            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                _log.LogWarning("TheTVDB login failed: HTTP {Status}", (int)resp.StatusCode);
                return null;
            }

            var body  = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            var login = JsonSerializer.Deserialize<TvdbLoginEnvelope>(body);
            var tok   = login?.Data?.Token;
            return string.IsNullOrWhiteSpace(tok) ? null : tok;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "TheTVDB login failed");
            return null;
        }
    }

    // ------------------------------------------------------------------ //
    // Helpers
    // ------------------------------------------------------------------ //

    private static HttpRequestMessage BuildRequest(HttpMethod method, string url, string token)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return req;
    }

    // ------------------------------------------------------------------ //
    // DTOs
    // ------------------------------------------------------------------ //

    private sealed class TvdbLoginEnvelope
    {
        [JsonPropertyName("data")] public TvdbLoginData? Data { get; set; }
    }

    private sealed class TvdbLoginData
    {
        [JsonPropertyName("token")] public string? Token { get; set; }
    }

    private sealed class TvdbSeriesExtendedEnvelope
    {
        [JsonPropertyName("data")] public TvdbSeriesExtended? Data { get; set; }
    }

    private sealed class TvdbSeriesExtended
    {
        [JsonPropertyName("name")]        public string? Name       { get; set; }
        [JsonPropertyName("overview")]    public string? Overview   { get; set; }
        [JsonPropertyName("firstAired")]  public string? FirstAired { get; set; }
        [JsonPropertyName("score")]       public float   Score      { get; set; }
        [JsonPropertyName("status")]      public TvdbStatus?   Status       { get; set; }
        [JsonPropertyName("companies")]   public List<TvdbCompany>? Companies { get; set; }
        [JsonPropertyName("translations")]public TvdbTranslations? Translations { get; set; }
    }

    private sealed class TvdbStatus
    {
        [JsonPropertyName("name")] public string? Name { get; set; }
    }

    private sealed class TvdbCompany
    {
        [JsonPropertyName("name")]        public string? Name        { get; set; }
        [JsonPropertyName("companyType")] public TvdbCompanyType? CompanyType { get; set; }
    }

    private sealed class TvdbCompanyType
    {
        [JsonPropertyName("companyTypeName")] public string? CompanyTypeName { get; set; }
    }

    private sealed class TvdbTranslations
    {
        [JsonPropertyName("nameTranslations")]
        public List<TvdbTranslationItem>? NameTranslations { get; set; }
    }

    private sealed class TvdbTranslationItem
    {
        [JsonPropertyName("language")] public string? Language { get; set; }
        [JsonPropertyName("name")]     public string? Name     { get; set; }
    }
}
