namespace Feedarr.Api.Options;

public sealed class AppOptions
{
    public string DataDir { get; set; } = "data";
    public string DbFileName { get; set; } = "feedarr.db";
    public int SyncIntervalMinutes { get; set; } = 60;
    public int SyncSourcesMaxConcurrency { get; set; } = 2;
    public int RssLimit { get; set; } = 100;
    public int RssLimitPerCategory { get; set; } = 50;
    public int RssLimitGlobalPerSource { get; set; } = 250;
    public bool RssOnlySync { get; set; } = false;
    public int StorageUsageCacheTtlSeconds { get; set; } = 30;
    public int SystemStatusCacheSeconds { get; set; } = 7;
    public int PosterStatsRefreshSeconds { get; set; } = 60;
    public int BadgesSseCoalesceMs { get; set; } = 750;
    public int BadgesSummaryCacheSeconds { get; set; } = 3;
    public int ThumbEnqueueTimeoutMs { get; set; } = 2000;
    public int ThumbWorkers { get; set; } = 1;
    public int MissingPosterSweepMinutes { get; set; } = 10;
    public int MissingPosterSweepBatchSize { get; set; } = 200;
    public int MissingPosterSweepShortCooldownMinutes { get; set; } = 15;
    public int MissingPosterSweepHardFailCooldownMinutes { get; set; } = 1440;

    /// <summary>
    /// Folder where the config folders of the other apps are mounted read-only
    /// (all-in-one stack: /appconfig/sonarr, /appconfig/radarr, ...). Used to discover API keys.
    /// </summary>
    public string AppConfigRoot { get; set; } = "/appconfig";

    /// <summary>
    /// true when Feedarr was installed by the Proxmox stack installer together with
    /// Radarr, Sonarr, Prowlarr, Seerr, qBittorrent and Tautulli: the first-run wizard
    /// then starts with the stack setup (/stack-setup).
    /// </summary>
    public bool StackMode { get; set; }

    /// <summary>URL under which the other containers reach Feedarr (Seerr webhook auto-setup).</summary>
    public string? InternalUrl { get; set; }
}
