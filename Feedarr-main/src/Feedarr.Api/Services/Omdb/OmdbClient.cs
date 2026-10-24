using System.Text.Json;
using System.Text.Json.Serialization;
using Feedarr.Api.Services.ExternalProviders;

namespace Feedarr.Api.Services.Omdb;

/// <summary>
/// Fetches IMDb score, Rotten Tomatoes %, and Metascore from the OMDb API.
/// Free tier: 1 000 requests/day — results are stored in the releases table
/// (ext_ratings_fetched_at) so each title is fetched only once.
/// API reference: https://www.omdbapi.com/
/// </summary>
public sealed class OmdbClient
{
    public sealed record RatingsResult(
        string?  ImdbId,
        float?   ImdbScore,
        int?     ImdbVotes,
        int?     RottenTomatoes,
        int?     Metascore);

    private readonly HttpClient _http;
    private readonly ActiveExternalProviderConfigResolver _config;
    private readonly ILogger<OmdbClient> _log;

    private const string BaseUrl = "https://www.omdbapi.com/";

    /// <summary>
    /// Thrown when OMDb could not give a definitive answer (network error, HTTP error,
    /// invalid key, daily limit reached). Callers must not cache this as "no ratings".
    /// </summary>
    public sealed class OmdbUnavailableException : Exception
    {
        public bool IsQuotaOrAuthError { get; }

        public OmdbUnavailableException(string message, bool isQuotaOrAuthError = false, Exception? inner = null)
            : base(message, inner)
        {
            IsQuotaOrAuthError = isQuotaOrAuthError;
        }
    }

    /// <summary>True when the OMDb provider is enabled and has an API key.</summary>
    public bool IsConfigured() => GetApiKey() is not null;

    public OmdbClient(
        HttpClient http,
        ActiveExternalProviderConfigResolver config,
        ILogger<OmdbClient> log)
    {
        _http   = http;
        _config = config;
        _log    = log;
    }

    // ------------------------------------------------------------------ //
    // Public API
    // ------------------------------------------------------------------ //

    /// <summary>
    /// Looks up ratings by IMDb ID (preferred, exact match).
    /// Returns null when OMDb definitively has no entry for the id (or OMDb is not configured);
    /// throws <see cref="OmdbUnavailableException"/> on transient / quota failures.
    /// </summary>
    public async Task<RatingsResult?> GetByImdbIdAsync(string imdbId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(imdbId)) return null;
        var key = GetApiKey();
        if (key is null) return null;

        var url = $"{BaseUrl}?i={Uri.EscapeDataString(imdbId)}&apikey={Uri.EscapeDataString(key)}";
        return await FetchAsync(url, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Looks up ratings by title and optional year (fallback when IMDb ID is unknown).
    /// </summary>
    public async Task<RatingsResult?> GetByTitleAsync(string title, int? year, string type, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        var key = GetApiKey();
        if (key is null) return null;

        var t = type switch { "series" => "series", _ => "movie" };
        var yearSuffix = year.HasValue ? $"&y={year.Value}" : "";
        var url = $"{BaseUrl}?t={Uri.EscapeDataString(title)}&type={t}{yearSuffix}&apikey={Uri.EscapeDataString(key)}";
        return await FetchAsync(url, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Tests the configured API key by fetching a known movie.
    /// </summary>
    public Task<(bool ok, string? error)> TestConnectionAsync(CancellationToken ct)
        => TestConnectionAsync(null, ct);

    /// <summary>
    /// Tests <paramref name="apiKeyOverride"/> (the key typed in the UI) or, when empty,
    /// the stored key — regardless of whether the provider is enabled yet.
    /// </summary>
    public async Task<(bool ok, string? error)> TestConnectionAsync(string? apiKeyOverride, CancellationToken ct)
    {
        var key = string.IsNullOrWhiteSpace(apiKeyOverride)
            ? GetApiKey(requireEnabled: false)
            : apiKeyOverride.Trim();
        if (key is null) return (false, "OMDb API key not configured.");
        try
        {
            // Inception — always available
            var url = $"{BaseUrl}?i=tt1375666&apikey={Uri.EscapeDataString(key)}";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
                return (false, $"HTTP {(int)resp.StatusCode}");

            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(body);
            var response = doc.RootElement.GetProperty("Response").GetString();
            return string.Equals(response, "True", StringComparison.OrdinalIgnoreCase)
                ? (true, null)
                : (false, doc.RootElement.TryGetProperty("Error", out var err) ? err.GetString() : "Unknown error");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "OMDb connection test failed");
            return (false, ex.Message);
        }
    }

    // ------------------------------------------------------------------ //
    // Private helpers
    // ------------------------------------------------------------------ //

    private string? GetApiKey(bool requireEnabled = true)
    {
        var config = _config.Resolve(ExternalProviderKeys.Omdb);
        if (requireEnabled && !config.Enabled) return null;
        config.Auth.TryGetValue("apiKey", out var key);
        return string.IsNullOrWhiteSpace(key) ? null : key.Trim();
    }

    private async Task<RatingsResult?> FetchAsync(string url, CancellationToken ct)
    {
        string body;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
            body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

            if (!resp.IsSuccessStatusCode)
            {
                // OMDb answers 401 for an invalid key and for "Request limit reached!"
                var authOrQuota = (int)resp.StatusCode is 401 or 403 or 429;
                throw new OmdbUnavailableException(
                    $"OMDb HTTP {(int)resp.StatusCode}: {ReadError(body) ?? "error"}",
                    authOrQuota);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (OmdbUnavailableException)
        {
            throw;
        }
        catch (Exception ex)
        {
            throw new OmdbUnavailableException("OMDb request failed: " + ex.Message, inner: ex);
        }

        OmdbResponse? r;
        try
        {
            r = JsonSerializer.Deserialize<OmdbResponse>(body);
        }
        catch (JsonException ex)
        {
            throw new OmdbUnavailableException("OMDb returned invalid JSON", inner: ex);
        }

        if (r is null)
            throw new OmdbUnavailableException("OMDb returned an empty response");

        if (!string.Equals(r.Response, "True", StringComparison.OrdinalIgnoreCase))
        {
            var error = r.Error ?? "";
            // "Movie not found!" / "Incorrect IMDb ID." are definitive answers → no ratings.
            if (error.Contains("not found", StringComparison.OrdinalIgnoreCase) ||
                error.Contains("Incorrect IMDb ID", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var authOrQuota = error.Contains("limit", StringComparison.OrdinalIgnoreCase) ||
                              error.Contains("API key", StringComparison.OrdinalIgnoreCase);
            throw new OmdbUnavailableException("OMDb error: " + (string.IsNullOrWhiteSpace(error) ? "unknown" : error), authOrQuota);
        }

        var imdbScore = TryParseFloat(r.ImdbRating);
        var imdbVotes = TryParseVotes(r.ImdbVotes);
        var metascore = TryParseInt(r.Metascore);
        var rt        = ExtractRtScore(r.Ratings);

        return new RatingsResult(
            string.IsNullOrWhiteSpace(r.ImdbId) ? null : r.ImdbId.Trim(),
            imdbScore,
            imdbVotes,
            rt,
            metascore);
    }

    private static string? ReadError(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.ValueKind == JsonValueKind.Object &&
                   doc.RootElement.TryGetProperty("Error", out var err) &&
                   err.ValueKind == JsonValueKind.String
                ? err.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static int? ExtractRtScore(List<OmdbRating>? ratings)
    {
        if (ratings is null) return null;
        var rt = ratings.FirstOrDefault(r =>
            string.Equals(r.Source, "Rotten Tomatoes", StringComparison.OrdinalIgnoreCase));
        if (rt?.Value is null) return null;
        // Value is like "73%" → parse integer
        var val = rt.Value.Trim().TrimEnd('%');
        return int.TryParse(val, System.Globalization.NumberStyles.Integer,
            System.Globalization.CultureInfo.InvariantCulture, out var n) ? n : null;
    }

    private static float? TryParseFloat(string? s)
        => float.TryParse(s, System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var f) ? f : null;

    private static int? TryParseInt(string? s)
        => int.TryParse(s, System.Globalization.NumberStyles.Integer,
            System.Globalization.CultureInfo.InvariantCulture, out var n) ? n : null;

    private static int? TryParseVotes(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var clean = s.Replace(",", "").Replace(".", "").Trim();
        return int.TryParse(clean, System.Globalization.NumberStyles.Integer,
            System.Globalization.CultureInfo.InvariantCulture, out var n) ? n : null;
    }

    // ------------------------------------------------------------------ //
    // DTOs
    // ------------------------------------------------------------------ //

    private sealed class OmdbResponse
    {
        [JsonPropertyName("imdbID")]   public string? ImdbId    { get; set; }
        [JsonPropertyName("imdbRating")] public string? ImdbRating { get; set; }
        [JsonPropertyName("imdbVotes")]  public string? ImdbVotes  { get; set; }
        [JsonPropertyName("Metascore")]  public string? Metascore  { get; set; }
        [JsonPropertyName("Ratings")]    public List<OmdbRating>? Ratings { get; set; }
        [JsonPropertyName("Response")]   public string? Response   { get; set; }
        [JsonPropertyName("Error")]      public string? Error      { get; set; }
    }

    private sealed class OmdbRating
    {
        [JsonPropertyName("Source")] public string? Source { get; set; }
        [JsonPropertyName("Value")]  public string? Value  { get; set; }
    }
}
