using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Feedarr.Api.Data.Repositories;
using Feedarr.Api.Models.Settings;
using Feedarr.Api.Services.Seerr;
using Microsoft.AspNetCore.Mvc;

namespace Feedarr.Api.Controllers;

/// <summary>
/// Webhook receiver for Overseerr / Jellyseerr.
///
/// Configure in Seerr:
///   Settings → Notifications → Webhook
///   URL: http(s)://&lt;feedarr&gt;/api/seerr/webhook
///   JSON Payload Type: Default
///   Events: Media Requested, Media Auto-Approved, Media Approved, Media Available, Media Declined
///   Authorization Header: required when Feedarr authentication is enabled.
///
/// Optional: add X-Feedarr-AppId header with the arr_apps.id of this Seerr instance.
/// </summary>
[ApiController]
[Route("api/seerr")]
public sealed class SeerrWebhookController : ControllerBase
{
    private readonly SeerrWebhookService _svc;
    private readonly SettingsRepository _settings;
    private readonly ILogger<SeerrWebhookController> _log;

    public SeerrWebhookController(
        SeerrWebhookService svc,
        SettingsRepository settings,
        ILogger<SeerrWebhookController> log)
    {
        _svc = svc;
        _settings = settings;
        _log = log;
    }

    // ------------------------------------------------------------------ //
    // POST /api/seerr/webhook  — called by Seerr
    // ------------------------------------------------------------------ //

    [HttpPost("webhook")]
    public IActionResult ReceiveWebhook(
        [FromBody] SeerrPayloadDto? dto,
        [FromHeader(Name = "X-Feedarr-AppId")] long? appId = null)
    {
        if (dto is null)
            return BadRequest(new { error = "empty payload" });

        var payload = dto.ToServicePayload();
        var result = _svc.HandleWebhook(payload, appId);

        return Ok(new
        {
            ok = true,
            id = result.Id,
            outcome = result.Outcome.ToString().ToLowerInvariant(),
            type = result.NotificationType
        });
    }

    // ------------------------------------------------------------------ //
    // GET /api/seerr/requests?filter=all|unmatched|matched  — list recent requests
    // (legacy: ?unmatched=true)
    // ------------------------------------------------------------------ //

    [HttpGet("requests")]
    public IActionResult GetRequests(
        [FromQuery] bool unmatched = false,
        [FromQuery] string? filter = null,
        [FromQuery] int limit = 100)
    {
        var normalizedFilter = (filter ?? (unmatched ? "unmatched" : "all")).Trim().ToLowerInvariant();
        var rows = normalizedFilter switch
        {
            "unmatched" => _svc.GetUnmatched(limit),
            "matched" => _svc.GetMatched(limit),
            _ => _svc.GetRecent(limit)
        };

        return Ok(rows.Select(r => new
        {
            id                  = r.Id,
            seerrRequestId      = r.SeerrRequestId,
            mediaType           = r.MediaType,
            tmdbId              = r.TmdbId,
            tvdbId              = r.TvdbId,
            title               = r.Title,
            year                = r.Year,
            type                = r.NotificationType,
            requestedBy         = r.RequestedBy,
            posterUrl           = r.PosterUrl,
            requestedSeasons    = r.RequestedSeasons,
            matched             = r.MatchedReleaseId.HasValue,
            matchedReleaseId    = r.MatchedReleaseId,
            matchedReleaseTitle = r.MatchedReleaseTitle,
            matchedReleaseSeeders = r.MatchedReleaseSeeders,
            matchedReleaseSize  = r.MatchedReleaseSize,
            matchedReleaseHun   = r.MatchedReleaseHun == 1,
            matchedAtTs         = r.MatchedAtTs,
            arrPushStatus       = r.ArrPushStatus,
            arrPushMessage      = r.ArrPushMessage,
            arrPushedAtTs       = r.ArrPushedAtTs,
            receivedAtTs        = r.ReceivedAtTs,
            updatedAtTs         = r.UpdatedAtTs,
        }));
    }

    // ------------------------------------------------------------------ //
    // POST /api/seerr/match  — manually trigger matching
    // ------------------------------------------------------------------ //

    [HttpPost("match")]
    public async Task<IActionResult> RunMatch(CancellationToken ct)
    {
        var matches = await _svc.TryMatchPendingAsync(ct).ConfigureAwait(false);
        return Ok(new { ok = true, matched = matches.Count, matches });
    }

    // GET /api/seerr/stats
    [HttpGet("stats")]
    public IActionResult GetStats() => Ok(_svc.GetStats());

    // DELETE /api/seerr/requests/{id}
    [HttpDelete("requests/{id:long}")]
    public IActionResult DeleteRequest([FromRoute] long id)
        => _svc.Delete(id) ? Ok(new { ok = true, id }) : NotFound(new { error = "request not found" });

    // POST /api/seerr/requests/{id}/rematch — clear the match and try again immediately
    [HttpPost("requests/{id:long}/rematch")]
    public async Task<IActionResult> Rematch([FromRoute] long id, CancellationToken ct)
    {
        if (!_svc.ResetMatch(id))
            return NotFound(new { error = "request not found" });

        var match = await _svc.MatchOneAsync(id, ct).ConfigureAwait(false);
        return Ok(new { ok = true, id, matched = match is not null, match });
    }

    // POST /api/seerr/requests/{id}/push — send the matched release to Sonarr / Radarr
    [HttpPost("requests/{id:long}/push")]
    public async Task<IActionResult> Push([FromRoute] long id, CancellationToken ct)
    {
        var result = await _svc.PushMatchedAsync(id, ct).ConfigureAwait(false);
        if (result is null)
            return NotFound(new { error = "request not found" });

        return Ok(new
        {
            ok = result.Ok,
            approved = result.Approved,
            status = result.Status,
            message = result.Summary,
            app = result.AppName
        });
    }

    // GET / PUT /api/seerr/settings
    [HttpGet("settings")]
    public IActionResult GetSettings() => Ok(_settings.GetSeerr());

    [HttpPut("settings")]
    public IActionResult PutSettings([FromBody] SeerrSettings? dto)
    {
        if (dto is null)
            return BadRequest(new { error = "settings missing" });
        if (dto.MinSeeders < 0 || dto.MinSeeders > 10_000)
            return BadRequest(new { error = "minSeeders must be between 0 and 10000" });

        _settings.SaveSeerr(dto);
        return Ok(_settings.GetSeerr());
    }

    // ------------------------------------------------------------------ //
    // DTOs — Overseerr / Jellyseerr webhook JSON shape
    //
    // The default Seerr template sends every value as a string
    // ("tmdbId": "603", "tvdbId": "", "request_id": "12"), while custom
    // templates may send numbers. FlexibleStringConverter accepts both.
    // ------------------------------------------------------------------ //

    public sealed class SeerrPayloadDto
    {
        [JsonPropertyName("notification_type")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? NotificationType { get; set; }

        [JsonPropertyName("subject")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? Subject { get; set; }

        [JsonPropertyName("message")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? Message { get; set; }

        [JsonPropertyName("image")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? Image { get; set; }

        [JsonPropertyName("media")]
        public SeerrMediaDto? Media { get; set; }

        [JsonPropertyName("request")]
        public SeerrRequestDto? Request { get; set; }

        /// <summary>"{{extra}}": [{ "name": "Requested Seasons", "value": "1, 2" }, ...]</summary>
        [JsonPropertyName("extra")]
        [JsonConverter(typeof(FlexibleExtraListConverter))]
        public List<SeerrExtraDto>? Extra { get; set; }

        public SeerrWebhookService.WebhookPayload ToServicePayload() => new()
        {
            NotificationType = NotificationType,
            Subject          = Subject,
            Message          = Message,
            Image            = Image,
            Extra            = Extra?
                .Where(e => !string.IsNullOrWhiteSpace(e.Name))
                .Select(e => new KeyValuePair<string, string?>(e.Name!, e.Value))
                .ToList(),
            Media = Media is null ? null : new SeerrWebhookService.WebhookPayload.MediaInfo
            {
                MediaType = Media.MediaType,
                TmdbId    = Media.TmdbId,
                TvdbId    = Media.TvdbId,
                ImdbId    = Media.ImdbId,
                Status    = Media.Status,
            },
            Request = Request is null ? null : new SeerrWebhookService.WebhookPayload.RequestInfo
            {
                RequestId           = Request.RequestId,
                RequestedByUsername = Request.RequestedByUsername,
            },
        };
    }

    public sealed class SeerrMediaDto
    {
        [JsonPropertyName("media_type")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? MediaType { get; set; }

        [JsonPropertyName("tmdbId")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? TmdbId { get; set; }

        [JsonPropertyName("tvdbId")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? TvdbId { get; set; }

        [JsonPropertyName("imdbId")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? ImdbId { get; set; }

        [JsonPropertyName("status")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? Status { get; set; }
    }

    public sealed class SeerrRequestDto
    {
        [JsonPropertyName("request_id")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? RequestId { get; set; }

        [JsonPropertyName("requestedBy_username")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? RequestedByUsername { get; set; }
    }

    public sealed class SeerrExtraDto
    {
        [JsonPropertyName("name")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? Name { get; set; }

        [JsonPropertyName("value")]
        [JsonConverter(typeof(FlexibleStringConverter))]
        public string? Value { get; set; }
    }

    /// <summary>
    /// Accepts the "extra" array, but tolerates null / an object / a string so an unusual
    /// custom template never makes the whole webhook fail with HTTP 400.
    /// </summary>
    public sealed class FlexibleExtraListConverter : JsonConverter<List<SeerrExtraDto>?>
    {
        public override bool HandleNull => true;

        public override List<SeerrExtraDto>? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.StartArray)
            {
                if (reader.TokenType is JsonTokenType.StartObject)
                    reader.Skip();
                return null;
            }

            var list = new List<SeerrExtraDto>();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
            {
                if (reader.TokenType == JsonTokenType.StartObject)
                {
                    var item = JsonSerializer.Deserialize<SeerrExtraDto>(ref reader, options);
                    if (item is not null) list.Add(item);
                }
                else if (reader.TokenType == JsonTokenType.StartArray)
                {
                    reader.Skip();
                }
            }
            return list;
        }

        public override void Write(Utf8JsonWriter writer, List<SeerrExtraDto>? value, JsonSerializerOptions options)
            => JsonSerializer.Serialize(writer, value, options);
    }

    /// <summary>Reads a JSON string, number, boolean or null into a string.</summary>
    public sealed class FlexibleStringConverter : JsonConverter<string?>
    {
        public override bool HandleNull => true;

        public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.Null:
                    return null;
                case JsonTokenType.String:
                    var s = reader.GetString();
                    return string.IsNullOrWhiteSpace(s) ? null : s;
                case JsonTokenType.Number:
                    return reader.TryGetInt64(out var l)
                        ? l.ToString(CultureInfo.InvariantCulture)
                        : reader.GetDouble().ToString(CultureInfo.InvariantCulture);
                case JsonTokenType.True:
                    return "true";
                case JsonTokenType.False:
                    return "false";
                default:
                    // Objects / arrays are not meaningful here: skip them.
                    reader.Skip();
                    return null;
            }
        }

        public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options)
        {
            if (value is null) writer.WriteNullValue();
            else writer.WriteStringValue(value);
        }
    }
}
