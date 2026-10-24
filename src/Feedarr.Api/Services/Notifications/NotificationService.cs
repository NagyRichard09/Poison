using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Feedarr.Api.Data.Repositories;
using Feedarr.Api.Models.Settings;
using Feedarr.Api.Services.Security;

namespace Feedarr.Api.Services.Notifications;

public enum NotificationEventKind
{
    Test,
    SeerrRequest,
    SeerrMatch,
    ArrPush,
    DiskLow
}

/// <summary>A notification to deliver to every enabled channel.</summary>
public sealed record NotificationMessage(
    NotificationEventKind Kind,
    string Title,
    string Message,
    string? Url = null,
    string? ImageUrl = null,
    bool IsError = false,
    IReadOnlyDictionary<string, object?>? Data = null);

public sealed record NotificationChannelResult(string Channel, bool Ok, string? Error);

/// <summary>
/// Sends notifications to Discord (webhook embeds), ntfy (JSON publish) and a generic
/// JSON webhook. Delivery failures are logged and never thrown to callers.
///
/// References:
///  - Discord: POST {webhook} {"username","embeds":[{"title","description","url","color","thumbnail"}]}
///  - ntfy:    POST {server}/ {"topic","title","message","tags","priority","click","attach"}
///             optional "Authorization: Bearer &lt;token&gt;"
/// </summary>
public sealed class NotificationService
{
    public const string HttpClientName = "notifications";

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly SettingsRepository _settings;
    private readonly ILogger<NotificationService> _log;

    public NotificationService(
        IHttpClientFactory httpClientFactory,
        SettingsRepository settings,
        ILogger<NotificationService> log)
    {
        _httpClientFactory = httpClientFactory;
        _settings = settings;
        _log = log;
    }

    /// <summary>
    /// Fire-and-forget delivery for event hooks (Seerr matching, arr push, ...).
    /// </summary>
    public void NotifyInBackground(NotificationMessage message)
    {
        NotificationSettings settings;
        try
        {
            settings = _settings.GetNotifications();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Notifications: failed to load settings");
            return;
        }

        if (!settings.Enabled || !IsEventEnabled(settings, message.Kind) || !HasAnyChannel(settings))
            return;

        _ = Task.Run(async () =>
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                await SendAsync(settings, message, cts.Token).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Notifications: background delivery failed");
            }
        });
    }

    /// <summary>Sends a test message with the given (possibly unsaved) settings.</summary>
    public Task<List<NotificationChannelResult>> SendTestAsync(NotificationSettings settings, CancellationToken ct)
        => SendAsync(settings, new NotificationMessage(
            NotificationEventKind.Test,
            "Poisonarr teszt értesítés",
            "Ha ezt látod, az értesítések működnek. ✅"), ct);

    public static bool HasAnyChannel(NotificationSettings s)
        => !string.IsNullOrWhiteSpace(s.DiscordWebhookUrl) ||
           !string.IsNullOrWhiteSpace(s.NtfyTopicUrl) ||
           !string.IsNullOrWhiteSpace(s.WebhookUrl);

    private static bool IsEventEnabled(NotificationSettings s, NotificationEventKind kind) => kind switch
    {
        NotificationEventKind.SeerrRequest => s.OnSeerrRequest,
        NotificationEventKind.SeerrMatch => s.OnSeerrMatch,
        NotificationEventKind.ArrPush => s.OnArrPush,
        NotificationEventKind.DiskLow => s.OnDiskLow,
        _ => true
    };

    private async Task<List<NotificationChannelResult>> SendAsync(
        NotificationSettings settings, NotificationMessage message, CancellationToken ct)
    {
        var tasks = new List<Task<NotificationChannelResult>>();
        if (!string.IsNullOrWhiteSpace(settings.DiscordWebhookUrl))
            tasks.Add(SendSafeAsync("discord", () => SendDiscordAsync(settings.DiscordWebhookUrl!, message, ct)));
        if (!string.IsNullOrWhiteSpace(settings.NtfyTopicUrl))
            tasks.Add(SendSafeAsync("ntfy", () => SendNtfyAsync(settings.NtfyTopicUrl!, settings.NtfyToken, message, ct)));
        if (!string.IsNullOrWhiteSpace(settings.WebhookUrl))
            tasks.Add(SendSafeAsync("webhook", () => SendWebhookAsync(settings.WebhookUrl!, message, ct)));

        var results = (await Task.WhenAll(tasks).ConfigureAwait(false)).ToList();
        foreach (var r in results.Where(r => !r.Ok))
        {
            _log.LogWarning("Notification via {Channel} failed: {Error}", r.Channel, r.Error);
        }
        return results;
    }

    private static async Task<NotificationChannelResult> SendSafeAsync(string channel, Func<Task> send)
    {
        try
        {
            await send().ConfigureAwait(false);
            return new NotificationChannelResult(channel, true, null);
        }
        catch (Exception ex)
        {
            return new NotificationChannelResult(channel, false, ErrorMessageSanitizer.Sanitize(ex.Message));
        }
    }

    // ------------------------------------------------------------------ //
    // Channels
    // ------------------------------------------------------------------ //

    private async Task SendDiscordAsync(string webhookUrl, NotificationMessage m, CancellationToken ct)
    {
        var uri = ValidateUrl(webhookUrl, "Discord webhook");
        var embed = new Dictionary<string, object?>
        {
            ["title"] = Truncate(m.Title, 256),
            ["description"] = Truncate(m.Message, 4000),
            ["url"] = IsHttpUrl(m.Url) ? m.Url : null,
            ["color"] = m.IsError ? 0xA32D2D : ColorFor(m.Kind),
            ["timestamp"] = DateTimeOffset.UtcNow.ToString("O"),
            ["footer"] = new Dictionary<string, object?> { ["text"] = "Poisonarr" },
        };
        if (IsHttpUrl(m.ImageUrl))
            embed["thumbnail"] = new Dictionary<string, object?> { ["url"] = m.ImageUrl };

        var payload = new Dictionary<string, object?>
        {
            ["username"] = "Poisonarr",
            ["embeds"] = new[] { WithoutNulls(embed) }
        };

        await PostJsonAsync(uri, payload, null, ct).ConfigureAwait(false);
    }

    private async Task SendNtfyAsync(string topicUrl, string? token, NotificationMessage m, CancellationToken ct)
    {
        var uri = ValidateUrl(topicUrl, "ntfy topic URL");
        var segments = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0)
            throw new InvalidOperationException("ntfy URL must contain the topic, e.g. https://ntfy.sh/feedarr");

        // JSON publishing goes to the server root (keeping any reverse-proxy sub-path);
        // the topic travels in the body. This keeps UTF-8 titles intact (headers are ASCII only).
        var topic = segments[^1];
        var basePath = "/" + string.Join('/', segments[..^1]);
        if (!basePath.EndsWith('/')) basePath += "/";
        var publishUri = new UriBuilder(uri) { Path = basePath, Query = "" }.Uri;

        var payload = new Dictionary<string, object?>
        {
            ["topic"] = topic,
            ["title"] = Truncate(m.Title, 250),
            ["message"] = Truncate(m.Message, 4000),
            ["tags"] = new[] { m.IsError ? "warning" : TagFor(m.Kind) },
            ["priority"] = m.Kind is NotificationEventKind.SeerrMatch or NotificationEventKind.DiskLow ? 4 : 3,
            ["click"] = IsHttpUrl(m.Url) ? m.Url : null,
            ["attach"] = IsHttpUrl(m.ImageUrl) ? m.ImageUrl : null,
        };

        await PostJsonAsync(publishUri, WithoutNulls(payload), string.IsNullOrWhiteSpace(token) ? null : token.Trim(), ct)
            .ConfigureAwait(false);
    }

    private async Task SendWebhookAsync(string webhookUrl, NotificationMessage m, CancellationToken ct)
    {
        var uri = ValidateUrl(webhookUrl, "webhook URL");
        var payload = new Dictionary<string, object?>
        {
            ["source"] = "feedarr",
            ["event"] = EventName(m.Kind),
            ["title"] = m.Title,
            ["message"] = m.Message,
            ["url"] = m.Url,
            ["imageUrl"] = m.ImageUrl,
            ["isError"] = m.IsError,
            ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            ["data"] = m.Data,
        };
        await PostJsonAsync(uri, payload, null, ct).ConfigureAwait(false);
    }

    private async Task PostJsonAsync(Uri uri, object payload, string? bearerToken, CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient(HttpClientName);
        using var req = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload, JsonOpts), Encoding.UTF8, "application/json")
        };
        if (bearerToken is not null)
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);

        using var resp = await client.SendAsync(req, ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new HttpRequestException($"HTTP {(int)resp.StatusCode}: {Truncate(body, 200)}");
        }
    }

    // ------------------------------------------------------------------ //
    // Helpers
    // ------------------------------------------------------------------ //

    private static Uri ValidateUrl(string raw, string what)
    {
        if (!Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidOperationException($"Invalid {what}: only http(s) URLs are allowed");
        }
        return uri;
    }

    public static bool IsValidOptionalUrl(string? raw)
        => string.IsNullOrWhiteSpace(raw) ||
           (Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var uri) &&
            (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps));

    // Dictionary entries are not covered by JsonIgnoreCondition.WhenWritingNull;
    // Discord / ntfy validate optional fields, so drop the null ones explicitly.
    private static Dictionary<string, object?> WithoutNulls(Dictionary<string, object?> source)
        => source.Where(kv => kv.Value is not null).ToDictionary(kv => kv.Key, kv => kv.Value);

    private static bool IsHttpUrl(string? url)
        => !string.IsNullOrWhiteSpace(url) &&
           Uri.TryCreate(url, UriKind.Absolute, out var u) &&
           (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps);

    private static string Truncate(string? value, int max)
    {
        var s = value ?? "";
        return s.Length <= max ? s : s[..(max - 1)] + "…";
    }

    private static int ColorFor(NotificationEventKind kind) => kind switch
    {
        NotificationEventKind.SeerrRequest => 0x185FA5,
        NotificationEventKind.SeerrMatch => 0x0F6E56,
        NotificationEventKind.ArrPush => 0x534AB7,
        NotificationEventKind.DiskLow => 0xA32D2D,
        _ => 0x6B7280
    };

    private static string TagFor(NotificationEventKind kind) => kind switch
    {
        NotificationEventKind.SeerrRequest => "inbox_tray",
        NotificationEventKind.SeerrMatch => "white_check_mark",
        NotificationEventKind.ArrPush => "arrow_right",
        NotificationEventKind.DiskLow => "floppy_disk",
        _ => "bell"
    };

    private static string EventName(NotificationEventKind kind) => kind switch
    {
        NotificationEventKind.SeerrRequest => "seerr.request",
        NotificationEventKind.SeerrMatch => "seerr.match",
        NotificationEventKind.ArrPush => "arr.push",
        NotificationEventKind.DiskLow => "disk.low",
        _ => "test"
    };
}
