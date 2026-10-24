using Feedarr.Api.Data.Repositories;
using Feedarr.Api.Models.Settings;

namespace Feedarr.Api.Services.DiskSpace;

/// <summary>Free / total space of one monitored volume.</summary>
public sealed record DiskVolumeStatus(
    string Path,
    string Label,
    string MountPoint,
    long FreeBytes,
    long TotalBytes,
    double FreePercent,
    bool IsLow,
    bool IsDataDir,
    bool IsCustom,
    IReadOnlyList<string> Paths);

public sealed record DiskSpaceSnapshot(
    IReadOnlyList<DiskVolumeStatus> Volumes,
    IReadOnlyList<string> MissingPaths,
    long CheckedAtTs);

/// <summary>
/// Collects free disk space for the Feedarr data folder, the standard container
/// mount points and user configured folders. Folders on the same filesystem are
/// merged by mount point (Linux: /proc/self/mountinfo), so "/" and "/app/data"
/// on the same disk are listed once. Results are cached for a short time.
/// </summary>
public sealed class DiskSpaceService
{
    private static readonly string[] DefaultLinuxPaths =
    {
        "/", "/data", "/config", "/downloads", "/media", "/tv", "/movies", "/mnt", "/volume1"
    };

    // Pseudo / virtual filesystems that never hold user data.
    private static readonly HashSet<string> IgnoredFsTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2", "mqueue",
        "securityfs", "debugfs", "tracefs", "pstore", "bpf", "configfs", "fusectl",
        "hugetlbfs", "autofs", "binfmt_misc", "nsfs", "rpc_pipefs", "squashfs", "efivarfs"
    };

    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);

    private readonly SettingsRepository _settings;
    private readonly StorageUsageCacheService _storage;
    private readonly ILogger<DiskSpaceService> _log;
    private readonly object _gate = new();
    private DiskSpaceSnapshot? _cached;
    private string? _cachedKey;
    private DateTimeOffset _cachedAt;

    public DiskSpaceService(
        SettingsRepository settings,
        StorageUsageCacheService storage,
        ILogger<DiskSpaceService> log)
    {
        _settings = settings;
        _storage = storage;
        _log = log;
    }

    public DiskSpaceSettings GetSettings() => _settings.GetDiskSpace();

    public DiskSpaceSnapshot GetSnapshot(bool forceRefresh = false)
        => GetSnapshot(_settings.GetDiskSpace(), forceRefresh);

    public DiskSpaceSnapshot GetSnapshot(DiskSpaceSettings settings, bool forceRefresh = false)
    {
        var key = string.Join("|",
            settings.IncludeDefaultPaths, settings.WarnFreePercent, settings.WarnFreeGb,
            string.Join(";", settings.ExtraPaths));

        lock (_gate)
        {
            if (!forceRefresh && _cached is not null && _cachedKey == key &&
                DateTimeOffset.UtcNow - _cachedAt < CacheDuration)
            {
                return _cached;
            }
        }

        var snapshot = Collect(settings);

        lock (_gate)
        {
            _cached = snapshot;
            _cachedKey = key;
            _cachedAt = DateTimeOffset.UtcNow;
        }
        return snapshot;
    }

    public void Invalidate()
    {
        lock (_gate) _cached = null;
    }

    /// <summary>Validates a user supplied folder: absolute path to an existing directory.</summary>
    public static string? ValidatePath(string? raw)
    {
        var path = (raw ?? "").Trim();
        if (path.Length == 0) return "Üres útvonal.";
        if (path.Length > 1024) return "Túl hosszú útvonal.";
        if (path.IndexOfAny(new[] { '\0', '\n', '\r' }) >= 0) return "Érvénytelen karakter az útvonalban.";
        if (!Path.IsPathFullyQualified(path)) return $"Teljes (abszolút) útvonal szükséges: {path}";
        return null;
    }

    private DiskSpaceSnapshot Collect(DiskSpaceSettings settings)
    {
        var dataDir = SafeFullPath(_storage.DataDirAbs);
        var custom = settings.ExtraPaths.Select(SafeFullPath).Where(p => p is not null).Cast<string>().ToList();

        var candidates = new List<(string Path, bool IsCustom, bool IsDataDir)>();
        if (dataDir is not null) candidates.Add((dataDir, false, true));
        candidates.AddRange(custom.Select(p => (p, true, false)));

        if (settings.IncludeDefaultPaths)
        {
            if (OperatingSystem.IsWindows())
            {
                foreach (var drive in SafeGetDrives())
                    candidates.Add((drive.RootDirectory.FullName, false, false));
            }
            else
            {
                candidates.AddRange(DefaultLinuxPaths.Select(p => (p, false, false)));
            }
        }

        var mounts = OperatingSystem.IsLinux() ? MountTable.Load(_log) : null;
        var byMount = new Dictionary<string, VolumeBuilder>(StringComparer.Ordinal);
        var missing = new List<string>();

        foreach (var (path, isCustom, isDataDir) in candidates)
        {
            try
            {
                if (!Directory.Exists(path))
                {
                    if (isCustom) missing.Add(path);
                    continue;
                }

                var mount = mounts?.FindMountPoint(path);
                if (mount is not null && IgnoredFsTypes.Contains(mount.FsType) && !isCustom && !isDataDir)
                    continue;

                var mountPoint = mount?.MountPoint ?? Path.GetPathRoot(path) ?? path;
                var drive = new DriveInfo(mountPoint);
                if (!drive.IsReady || drive.TotalSize <= 0) continue;

                if (!byMount.TryGetValue(mountPoint, out var builder))
                {
                    builder = new VolumeBuilder(mountPoint, drive.AvailableFreeSpace, drive.TotalSize,
                        string.IsNullOrWhiteSpace(drive.VolumeLabel) || drive.VolumeLabel == mountPoint
                            ? null
                            : drive.VolumeLabel);
                    byMount[mountPoint] = builder;
                }

                builder.Paths.Add(path);
                builder.IsCustom |= isCustom;
                builder.IsDataDir |= isDataDir;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
            {
                _log.LogDebug(ex, "Disk space: skipping inaccessible path {Path}", path);
                if (isCustom) missing.Add(path);
            }
        }

        var volumes = byMount.Values
            .Select(b => b.Build(settings))
            // Data dir first, then user folders, then the rest by mount point
            .OrderByDescending(v => v.IsDataDir)
            .ThenByDescending(v => v.IsCustom)
            .ThenBy(v => v.MountPoint, StringComparer.Ordinal)
            .ToList();

        return new DiskSpaceSnapshot(volumes, missing, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    }

    public static bool IsLow(long freeBytes, long totalBytes, DiskSpaceSettings settings)
    {
        if (totalBytes <= 0) return false;
        var freePercent = freeBytes * 100.0 / totalBytes;
        if (settings.WarnFreePercent > 0 && freePercent < settings.WarnFreePercent) return true;
        if (settings.WarnFreeGb > 0 && freeBytes < settings.WarnFreeGb * 1024L * 1024L * 1024L) return true;
        return false;
    }

    private static string? SafeFullPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        try
        {
            var full = Path.GetFullPath(path.Trim());
            return full.Length > 1 ? full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) : full;
        }
        catch
        {
            return null;
        }
    }

    private static IEnumerable<DriveInfo> SafeGetDrives()
    {
        try
        {
            return DriveInfo.GetDrives()
                .Where(d => d.IsReady && (d.DriveType == DriveType.Fixed || d.DriveType == DriveType.Network))
                .ToList();
        }
        catch
        {
            return Array.Empty<DriveInfo>();
        }
    }

    private sealed class VolumeBuilder
    {
        public VolumeBuilder(string mountPoint, long free, long total, string? label)
        {
            MountPoint = mountPoint;
            Free = free;
            Total = total;
            Label = label;
        }

        public string MountPoint { get; }
        public long Free { get; }
        public long Total { get; }
        public string? Label { get; }
        public bool IsCustom { get; set; }
        public bool IsDataDir { get; set; }
        public List<string> Paths { get; } = new();

        public DiskVolumeStatus Build(DiskSpaceSettings settings)
        {
            var displayPath = Paths.FirstOrDefault(p => !string.Equals(p, "/", StringComparison.Ordinal)) ?? MountPoint;
            var label = Label ?? (IsDataDir ? "Poisonarr adatok" : displayPath);
            var freePercent = Total > 0 ? Math.Round(Free * 100.0 / Total, 1) : 0;
            return new DiskVolumeStatus(
                displayPath, label, MountPoint, Free, Total, freePercent,
                DiskSpaceService.IsLow(Free, Total, settings), IsDataDir, IsCustom,
                Paths.Distinct(StringComparer.Ordinal).ToList());
        }
    }
}

/// <summary>Linux mount table (/proc/self/mountinfo, fallback /proc/mounts).</summary>
internal sealed class MountTable
{
    internal sealed record Entry(string MountPoint, string FsType);

    private readonly List<Entry> _entries;

    private MountTable(List<Entry> entries)
    {
        // Longest mount point first so FindMountPoint returns the most specific one.
        _entries = entries
            .GroupBy(e => e.MountPoint, StringComparer.Ordinal)
            .Select(g => g.Last())
            .OrderByDescending(e => e.MountPoint.Length)
            .ToList();
    }

    public static MountTable? Load(ILogger log)
    {
        try
        {
            if (File.Exists("/proc/self/mountinfo"))
                return Parse(File.ReadAllLines("/proc/self/mountinfo"), mountInfo: true);
            if (File.Exists("/proc/mounts"))
                return Parse(File.ReadAllLines("/proc/mounts"), mountInfo: false);
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "Disk space: could not read mount table");
        }
        return null;
    }

    internal static MountTable Parse(IEnumerable<string> lines, bool mountInfo)
    {
        var entries = new List<Entry>();
        foreach (var line in lines)
        {
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (mountInfo)
            {
                // id parent major:minor root mountpoint options [optional...] - fstype source superopts
                var sep = Array.IndexOf(parts, "-");
                if (parts.Length < 5 || sep < 0 || sep + 1 >= parts.Length) continue;
                entries.Add(new Entry(Unescape(parts[4]), parts[sep + 1]));
            }
            else
            {
                // source mountpoint fstype options dump pass
                if (parts.Length < 3) continue;
                entries.Add(new Entry(Unescape(parts[1]), parts[2]));
            }
        }
        return new MountTable(entries);
    }

    public Entry? FindMountPoint(string path)
    {
        foreach (var e in _entries)
        {
            if (e.MountPoint == "/" ||
                string.Equals(path, e.MountPoint, StringComparison.Ordinal) ||
                path.StartsWith(e.MountPoint.TrimEnd('/') + "/", StringComparison.Ordinal))
            {
                return e;
            }
        }
        return null;
    }

    // Mount points escape space, tab, newline and backslash as octal (\040 etc.).
    private static string Unescape(string value)
    {
        if (!value.Contains('\\')) return value;
        var sb = new System.Text.StringBuilder(value.Length);
        for (var i = 0; i < value.Length; i++)
        {
            if (value[i] == '\\' && i + 3 < value.Length &&
                value[i + 1] is >= '0' and <= '7' && value[i + 2] is >= '0' and <= '7' && value[i + 3] is >= '0' and <= '7')
            {
                sb.Append((char)Convert.ToInt32(value.Substring(i + 1, 3), 8));
                i += 3;
            }
            else
            {
                sb.Append(value[i]);
            }
        }
        return sb.ToString();
    }
}
