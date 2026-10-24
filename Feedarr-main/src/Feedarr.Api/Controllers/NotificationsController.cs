using Feedarr.Api.Data.Repositories;
using Feedarr.Api.Models.Settings;
using Feedarr.Api.Services.Notifications;
using Microsoft.AspNetCore.Mvc;

namespace Feedarr.Api.Controllers;

/// <summary>
/// Notification channels (Discord webhook, ntfy, generic webhook).
/// Secret values are never returned: the API exposes "has*" flags instead.
/// On PUT, a null secret keeps the stored value, an empty string clears it.
/// </summary>
[ApiController]
[Route("api/notifications")]
public sealed class NotificationsController : ControllerBase
{
    private readonly SettingsRepository _settings;
    private readonly NotificationService _notifications;

    public NotificationsController(SettingsRepository settings, NotificationService notifications)
    {
        _settings = settings;
        _notifications = notifications;
    }

    public sealed class NotificationSettingsDto
    {
        public bool Enabled { get; set; }
        public string? DiscordWebhookUrl { get; set; }
        public string? NtfyTopicUrl { get; set; }
        public string? NtfyToken { get; set; }
        public string? WebhookUrl { get; set; }
        public bool OnSeerrRequest { get; set; } = true;
        public bool OnSeerrMatch { get; set; } = true;
        public bool OnArrPush { get; set; } = true;
        public bool OnDiskLow { get; set; } = true;
    }

    [HttpGet("settings")]
    public IActionResult Get() => Ok(ToResponse(_settings.GetNotifications()));

    [HttpPut("settings")]
    public IActionResult Put([FromBody] NotificationSettingsDto? dto)
    {
        if (dto is null)
            return BadRequest(new { error = "settings missing" });

        var merged = Merge(_settings.GetNotifications(), dto);
        var error = Validate(merged);
        if (error is not null)
            return BadRequest(new { error });

        _settings.SaveNotifications(merged);
        return Ok(ToResponse(_settings.GetNotifications()));
    }

    /// <summary>Sends a test message using the posted (unsaved) values merged with the stored secrets.</summary>
    [HttpPost("test")]
    public async Task<IActionResult> Test([FromBody] NotificationSettingsDto? dto, CancellationToken ct)
    {
        var merged = dto is null ? _settings.GetNotifications() : Merge(_settings.GetNotifications(), dto);
        var error = Validate(merged);
        if (error is not null)
            return BadRequest(new { error });
        if (!NotificationService.HasAnyChannel(merged))
            return BadRequest(new { error = "Nincs beállított értesítési csatorna." });

        var results = await _notifications.SendTestAsync(merged, ct).ConfigureAwait(false);
        return Ok(new
        {
            ok = results.All(r => r.Ok),
            results = results.Select(r => new { channel = r.Channel, ok = r.Ok, error = r.Error })
        });
    }

    private static NotificationSettings Merge(NotificationSettings current, NotificationSettingsDto dto)
    {
        static string? MergeSecret(string? stored, string? incoming)
            => incoming is null ? stored : (string.IsNullOrWhiteSpace(incoming) ? null : incoming.Trim());

        return new NotificationSettings
        {
            Enabled = dto.Enabled,
            DiscordWebhookUrl = MergeSecret(current.DiscordWebhookUrl, dto.DiscordWebhookUrl),
            NtfyTopicUrl = MergeSecret(current.NtfyTopicUrl, dto.NtfyTopicUrl),
            NtfyToken = MergeSecret(current.NtfyToken, dto.NtfyToken),
            WebhookUrl = MergeSecret(current.WebhookUrl, dto.WebhookUrl),
            OnSeerrRequest = dto.OnSeerrRequest,
            OnSeerrMatch = dto.OnSeerrMatch,
            OnArrPush = dto.OnArrPush,
            OnDiskLow = dto.OnDiskLow,
        };
    }

    private static string? Validate(NotificationSettings s)
    {
        if (!NotificationService.IsValidOptionalUrl(s.DiscordWebhookUrl)) return "Érvénytelen Discord webhook URL.";
        if (!NotificationService.IsValidOptionalUrl(s.NtfyTopicUrl)) return "Érvénytelen ntfy URL.";
        if (!NotificationService.IsValidOptionalUrl(s.WebhookUrl)) return "Érvénytelen webhook URL.";
        if (!string.IsNullOrWhiteSpace(s.NtfyTopicUrl) &&
            Uri.TryCreate(s.NtfyTopicUrl, UriKind.Absolute, out var ntfy) &&
            ntfy.AbsolutePath.Trim('/').Length == 0)
        {
            return "Az ntfy URL-ben meg kell adni a topicot is (pl. https://ntfy.sh/feedarr).";
        }
        return null;
    }

    private static object ToResponse(NotificationSettings s) => new
    {
        enabled = s.Enabled,
        hasDiscordWebhookUrl = !string.IsNullOrWhiteSpace(s.DiscordWebhookUrl),
        hasNtfyTopicUrl = !string.IsNullOrWhiteSpace(s.NtfyTopicUrl),
        // The topic URL is not really secret (only the topic name is) but may embed credentials:
        // expose the host + topic without user-info so the UI can show what is configured.
        ntfyTopicDisplay = DisplayUrl(s.NtfyTopicUrl),
        hasNtfyToken = !string.IsNullOrWhiteSpace(s.NtfyToken),
        hasWebhookUrl = !string.IsNullOrWhiteSpace(s.WebhookUrl),
        webhookDisplay = DisplayUrl(s.WebhookUrl, hidePath: true),
        onSeerrRequest = s.OnSeerrRequest,
        onSeerrMatch = s.OnSeerrMatch,
        onArrPush = s.OnArrPush,
        onDiskLow = s.OnDiskLow,
    };

    private static string? DisplayUrl(string? raw, bool hidePath = false)
    {
        if (string.IsNullOrWhiteSpace(raw) || !Uri.TryCreate(raw, UriKind.Absolute, out var uri))
            return null;
        var path = hidePath ? "/…" : uri.AbsolutePath;
        return $"{uri.Scheme}://{uri.Authority.Split('@')[^1]}{path}";
    }
}
