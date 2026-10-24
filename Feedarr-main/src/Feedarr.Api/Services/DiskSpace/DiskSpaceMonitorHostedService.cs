using Feedarr.Api.Services.Notifications;

namespace Feedarr.Api.Services.DiskSpace;

/// <summary>
/// Checks the monitored volumes every 15 minutes and sends one notification when a
/// volume drops below the configured threshold. The alert re-arms once the volume
/// recovers (with a small hysteresis so it does not flap around the limit).
/// </summary>
public sealed class DiskSpaceMonitorHostedService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(1);

    private readonly DiskSpaceService _disk;
    private readonly NotificationService _notifications;
    private readonly ILogger<DiskSpaceMonitorHostedService> _log;
    private readonly HashSet<string> _alerted = new(StringComparer.Ordinal);

    public DiskSpaceMonitorHostedService(
        DiskSpaceService disk,
        NotificationService notifications,
        ILogger<DiskSpaceMonitorHostedService> log)
    {
        _disk = disk;
        _notifications = notifications;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(StartupDelay, stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                CheckOnce();
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Disk space check failed (non-fatal)");
            }
        }
        while (await WaitNextAsync(timer, stoppingToken).ConfigureAwait(false));
    }

    private static async Task<bool> WaitNextAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    internal void CheckOnce()
    {
        var settings = _disk.GetSettings();
        if (!settings.NotifyOnLow || (settings.WarnFreePercent <= 0 && settings.WarnFreeGb <= 0))
        {
            _alerted.Clear();
            return;
        }

        var snapshot = _disk.GetSnapshot(settings, forceRefresh: true);
        foreach (var v in snapshot.Volumes)
        {
            if (v.IsLow)
            {
                if (!_alerted.Add(v.MountPoint)) continue;

                _log.LogWarning(
                    "Low disk space on {MountPoint}: {Free} free of {Total} ({Percent}%)",
                    v.MountPoint, FormatBytes(v.FreeBytes), FormatBytes(v.TotalBytes), v.FreePercent);

                _notifications.NotifyInBackground(new NotificationMessage(
                    NotificationEventKind.DiskLow,
                    $"Kevés a szabad hely: {v.Label}",
                    $"{v.Path}: {FormatBytes(v.FreeBytes)} szabad / {FormatBytes(v.TotalBytes)} ({v.FreePercent:0.#}%)",
                    IsError: true,
                    Data: new Dictionary<string, object?>
                    {
                        ["path"] = v.Path, ["mountPoint"] = v.MountPoint,
                        ["freeBytes"] = v.FreeBytes, ["totalBytes"] = v.TotalBytes, ["freePercent"] = v.FreePercent
                    }));
            }
            else if (_alerted.Contains(v.MountPoint))
            {
                // Re-arm only after a clear recovery (2 percentage points above the limit).
                var recovered = settings.WarnFreePercent <= 0 || v.FreePercent >= settings.WarnFreePercent + 2;
                if (recovered) _alerted.Remove(v.MountPoint);
            }
        }
    }

    public static string FormatBytes(long bytes)
    {
        string[] units = { "B", "KB", "MB", "GB", "TB", "PB" };
        double value = bytes;
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }
        return unit >= 3
            ? $"{value.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture)} {units[unit]}"
            : $"{value.ToString("0", System.Globalization.CultureInfo.InvariantCulture)} {units[unit]}";
    }
}
