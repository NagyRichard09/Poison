using Microsoft.AspNetCore.Mvc;
using Feedarr.Api.Services.Prowlarr;
using Feedarr.Api.Data.Repositories;
using Feedarr.Api.Services.Security;

namespace Feedarr.Api.Controllers;

[ApiController]
[Route("api/prowlarr")]
public sealed class ProwlarrController : ControllerBase
{
    private readonly ProwlarrClient _prowlarr;
    private readonly SourceRepository _sources;
    private readonly ILogger<ProwlarrController> _log;

    public ProwlarrController(
        ProwlarrClient prowlarr,
        SourceRepository sources,
        ILogger<ProwlarrController> log)
    {
        _prowlarr = prowlarr;
        _sources = sources;
        _log = log;
    }

    public sealed class ProwlarrIndexersRequest
    {
        public string? BaseUrl { get; set; }
        public string? ApiKey { get; set; }
        public long? SourceId { get; set; }
    }

    [HttpPost("indexers")]
    public async Task<IActionResult> ListIndexers([FromBody] ProwlarrIndexersRequest dto, CancellationToken ct)
    {
        var baseUrl = (dto?.BaseUrl ?? "").Trim();
        var apiKey = (dto?.ApiKey ?? "").Trim();

        if (dto?.SourceId is > 0)
        {
            var src = _sources.Get(dto.SourceId.Value);
            if (src is null)
                return NotFound(new { error = "source not found" });

            baseUrl = ExtractBaseUrl(src.TorznabUrl);
            if (!string.IsNullOrWhiteSpace(src.ApiKey))
                apiKey = src.ApiKey;
        }

        if (string.IsNullOrWhiteSpace(baseUrl))
            return BadRequest(new { error = "baseUrl missing" });
        if (!OutboundUrlGuard.TryNormalizeProviderBaseUrl("prowlarr", baseUrl, out var normalizedBaseUrl, out var baseUrlError))
            return BadRequest(new { error = baseUrlError });
        if (string.IsNullOrWhiteSpace(apiKey))
            return BadRequest(new { error = "apiKey missing" });

        try
        {
            var list = await _prowlarr.ListIndexersAsync(normalizedBaseUrl, apiKey, ct);
            var result = list.Select(x => new
            {
                id = x.id,
                name = x.name,
                torznabUrl = x.torznabUrl
            }).ToList();
            return Ok(result);
        }
        catch (HttpRequestException ex)
        {
            _log.LogWarning(ex, "Prowlarr upstream error for sourceId={SourceId}", dto?.SourceId);
            return StatusCode(502, new { error = "upstream provider unavailable" });
        }
        catch (TaskCanceledException)
        {
            return StatusCode(504, new { error = "upstream provider timeout" });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Prowlarr indexers listing failed for sourceId={SourceId}", dto?.SourceId);
            return StatusCode(500, new { error = "internal server error" });
        }
    }

    /// <summary>
    /// Extracts the Prowlarr base URL from a Torznab URL.
    /// Handles both plain and reverse-proxy sub-path deployments.
    ///
    /// Examples:
    ///   http://localhost:9696/1/api           → http://localhost:9696
    ///   http://host/prowlarr/1/api            → http://host/prowlarr
    ///   http://host/prowlarr/1/api?apikey=x   → http://host/prowlarr
    ///   https://host/my/prefix/42/api/        → https://host/my/prefix
    /// </summary>
    private static string ExtractBaseUrl(string torznabUrl)
    {
        if (string.IsNullOrWhiteSpace(torznabUrl)) return "";

        // Strip query string before parsing the path
        var withoutQuery = torznabUrl;
        var qIdx = torznabUrl.IndexOf('?');
        if (qIdx >= 0) withoutQuery = torznabUrl[..qIdx];

        var url = withoutQuery.TrimEnd('/');

        // Must end with /api (case-insensitive)
        if (!url.EndsWith("/api", StringComparison.OrdinalIgnoreCase))
            return url; // Not a recognised Prowlarr Torznab URL — return as-is

        url = url[..^4]; // Remove "/api"

        // The segment immediately before /api must be a numeric indexer id
        var lastSlash = url.LastIndexOf('/');
        if (lastSlash > 0)
        {
            var segment = url[(lastSlash + 1)..];
            if (int.TryParse(segment, out _))
                url = url[..lastSlash]; // Remove "/{id}"
        }

        return url;
    }
}
