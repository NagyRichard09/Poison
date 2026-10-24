namespace Feedarr.Api.Models.Settings;

/// <summary>
/// Outbound notification channels (Discord webhook, ntfy, generic JSON webhook).
/// Secret values (URLs containing tokens, ntfy access token) are stored encrypted.
/// </summary>
public sealed class NotificationSettings
{
    public bool Enabled { get; set; }

    /// <summary>Discord channel webhook URL (https://discord.com/api/webhooks/...).</summary>
    public string? DiscordWebhookUrl { get; set; }

    /// <summary>Full ntfy topic URL, e.g. https://ntfy.sh/my-feedarr or http://ntfy.lan/feedarr.</summary>
    public string? NtfyTopicUrl { get; set; }

    /// <summary>Optional ntfy access token (sent as Bearer token).</summary>
    public string? NtfyToken { get; set; }

    /// <summary>Generic webhook: Feedarr POSTs a JSON document to this URL.</summary>
    public string? WebhookUrl { get; set; }

    /// <summary>A new Seerr request arrived (approved / auto-approved).</summary>
    public bool OnSeerrRequest { get; set; } = true;

    /// <summary>A release was found for a pending Seerr request.</summary>
    public bool OnSeerrMatch { get; set; } = true;

    /// <summary>A release was pushed to Sonarr / Radarr (result included).</summary>
    public bool OnArrPush { get; set; } = true;

    /// <summary>A monitored disk is running low on free space.</summary>
    public bool OnDiskLow { get; set; } = true;

    public NotificationSettings Clone() => (NotificationSettings)MemberwiseClone();
}

/// <summary>Behaviour of the Seerr (Overseerr / Jellyseerr) integration.</summary>
public sealed class SeerrSettings
{
    /// <summary>
    /// Automatically push the matched release to Sonarr / Radarr (release/push API).
    /// The arr app still applies its own quality profile and may reject the release.
    /// </summary>
    public bool AutoPushToArr { get; set; }

    /// <summary>Prefer releases with Hungarian audio / subtitles (tag_hun) when matching.</summary>
    public bool PreferHungarian { get; set; } = true;

    /// <summary>For TV requests: only accept releases of the requested seasons (or untagged packs).</summary>
    public bool StrictSeasonMatch { get; set; } = true;

    /// <summary>Ignore releases with fewer seeders than this when matching (0 = no limit).</summary>
    public int MinSeeders { get; set; }
}

/// <summary>Disk space monitoring (Settings → Tárhely, optional widget on the main screen).</summary>
public sealed class DiskSpaceSettings
{
    public const int MaxExtraPaths = 10;

    /// <summary>Show the free space widget on the main (library) screen.</summary>
    public bool ShowOnMainScreen { get; set; }

    /// <summary>
    /// Additional folders to monitor (e.g. the download or media folder mounted into the
    /// container: /downloads, /media). The Feedarr data folder is always monitored.
    /// </summary>
    public List<string> ExtraPaths { get; set; } = new();

    /// <summary>Warn when the free space falls below this percentage (0 = off).</summary>
    public int WarnFreePercent { get; set; } = 10;

    /// <summary>Warn when the free space falls below this many GB (0 = off).</summary>
    public int WarnFreeGb { get; set; }

    /// <summary>Send a notification (Discord / ntfy / webhook) when a volume runs low.</summary>
    public bool NotifyOnLow { get; set; } = true;

    /// <summary>Also list the standard container mount points (/, /data, /downloads, /media, ...).</summary>
    public bool IncludeDefaultPaths { get; set; } = true;
}

/// <summary>An application shortcut shown in the sidebar "Alkalmazások" menu.</summary>
public sealed class AppLink
{
    /// <summary>Stable slug, used in the /apps/{id} route.</summary>
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";

    /// <summary>seerr | prowlarr | sonarr | radarr | tautulli | qbittorrent | custom</summary>
    public string Type { get; set; } = "custom";

    /// <summary>
    /// URL opened by the browser. "{host}" is replaced with the host name Feedarr is
    /// reached on, so "http://{host}:8989" works from any device on the LAN.
    /// </summary>
    public string Url { get; set; } = "";

    /// <summary>Optional URL used by the Feedarr server for status checks (e.g. http://sonarr:8989 in Docker).</summary>
    public string? InternalUrl { get; set; }

    /// <summary>embed = inside Feedarr (iframe) | tab = new browser tab</summary>
    public string OpenMode { get; set; } = "embed";

    public bool Enabled { get; set; } = true;
}

public sealed class AppLinksSettings
{
    public const int MaxLinks = 30;
    public List<AppLink> Links { get; set; } = new();
}
