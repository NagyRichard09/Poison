using Feedarr.Api.Data.Repositories;
using Feedarr.Api.Models.Settings;
using Feedarr.Api.Services.DiskSpace;
using Microsoft.AspNetCore.Mvc;

namespace Feedarr.Api.Controllers;

/// <summary>
/// Free disk space for the settings page and the optional main screen widget.
///   GET /api/system/disk-space            — volumes + display settings (cached 30 s)
///   GET /api/system/disk-space/settings   — monitoring settings
///   PUT /api/system/disk-space/settings   — save settings
/// </summary>
[ApiController]
[Route("api/system/disk-space")]
public sealed class DiskSpaceController : ControllerBase
{
    private readonly DiskSpaceService _disk;
    private readonly SettingsRepository _settings;

    public DiskSpaceController(DiskSpaceService disk, SettingsRepository settings)
    {
        _disk = disk;
        _settings = settings;
    }

    [HttpGet]
    public IActionResult Get([FromQuery] bool refresh = false)
    {
        var settings = _settings.GetDiskSpace();
        var snapshot = _disk.GetSnapshot(settings, refresh);
        return Ok(new
        {
            showOnMainScreen = settings.ShowOnMainScreen,
            warnFreePercent = settings.WarnFreePercent,
            warnFreeGb = settings.WarnFreeGb,
            anyLow = snapshot.Volumes.Any(v => v.IsLow),
            checkedAtTs = snapshot.CheckedAtTs,
            missingPaths = snapshot.MissingPaths,
            volumes = snapshot.Volumes.Select(v => new
            {
                path = v.Path,
                label = v.Label,
                mountPoint = v.MountPoint,
                freeBytes = v.FreeBytes,
                totalBytes = v.TotalBytes,
                usedBytes = Math.Max(0, v.TotalBytes - v.FreeBytes),
                freePercent = v.FreePercent,
                isLow = v.IsLow,
                isDataDir = v.IsDataDir,
                isCustom = v.IsCustom,
                paths = v.Paths,
            })
        });
    }

    [HttpGet("settings")]
    public IActionResult GetSettings() => Ok(_settings.GetDiskSpace());

    [HttpPut("settings")]
    public IActionResult PutSettings([FromBody] DiskSpaceSettings? dto)
    {
        if (dto is null)
            return BadRequest(new { error = "settings missing" });

        var paths = (dto.ExtraPaths ?? new List<string>())
            .Select(p => (p ?? "").Trim())
            .Where(p => p.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (paths.Count > DiskSpaceSettings.MaxExtraPaths)
            return BadRequest(new { error = $"Legfeljebb {DiskSpaceSettings.MaxExtraPaths} mappa adható meg." });

        foreach (var path in paths)
        {
            var error = DiskSpaceService.ValidatePath(path);
            if (error is not null)
                return BadRequest(new { error });
        }

        if (dto.WarnFreePercent is < 0 or > 90)
            return BadRequest(new { error = "A figyelmeztetési szint 0 és 90% között lehet." });
        if (dto.WarnFreeGb is < 0 or > 100_000)
            return BadRequest(new { error = "A GB-os figyelmeztetési szint 0 és 100000 között lehet." });

        dto.ExtraPaths = paths;
        _settings.SaveDiskSpace(dto);
        _disk.Invalidate();
        return Ok(_settings.GetDiskSpace());
    }
}
