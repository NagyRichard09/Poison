using Feedarr.Api.Models.Settings;
using Feedarr.Api.Services.AppHub;
using Microsoft.AspNetCore.Mvc;

namespace Feedarr.Api.Controllers;

/// <summary>
/// Sidebar "Alkalmazások" hub.
///   GET  /api/app-hub         — configured links
///   PUT  /api/app-hub         — save links
///   GET  /api/app-hub/status     — online / embeddable status of the enabled links
///   GET  /api/app-hub/discover   — apps found in the shared config folder (no secrets returned)
///   POST /api/app-hub/auto-setup — wire Feedarr, Prowlarr, Sonarr, Radarr, qBittorrent and Seerr together
/// </summary>
[ApiController]
[Route("api/app-hub")]
public sealed class AppHubController : ControllerBase
{
    private readonly AppHubService _hub;

    public AppHubController(AppHubService hub)
    {
        _hub = hub;
    }

    [HttpGet]
    public IActionResult Get() => Ok(new { links = _hub.GetLinks() });

    [HttpPut]
    public IActionResult Put([FromBody] AppLinksSettings? dto)
    {
        var links = dto?.Links ?? new List<AppLink>();
        var error = _hub.ValidateLinks(links);
        if (error is not null)
            return BadRequest(new { error });

        _hub.SaveLinks(links);
        return Ok(new { links = _hub.GetLinks() });
    }

    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        var host = Request.Host.Host;
        var status = await _hub.CheckStatusAsync(host, ct).ConfigureAwait(false);
        return Ok(status);
    }

    [HttpGet("discover")]
    public IActionResult Discover()
    {
        var apps = _hub.Discover();
        return Ok(new
        {
            configRoot = _hub.ConfigRoot,
            apps = apps.Select(a => new
            {
                type = a.Type,
                name = a.Name,
                port = a.Port,
                urlBase = a.UrlBase,
                hasApiKey = a.HasApiKey,
                configPath = a.ConfigPath,
            }),
            defaults = AppCatalog.All.Select(d => AppHubService.BuildDefaultLink(d,
                apps.FirstOrDefault(a => a.Type == d.Type)?.Port,
                apps.FirstOrDefault(a => a.Type == d.Type)?.UrlBase)),
        });
    }

    [HttpPost("auto-setup")]
    public async Task<IActionResult> AutoSetup([FromBody] AutoSetupOptions? options, CancellationToken ct)
    {
        var steps = await _hub.AutoSetupAsync(options ?? new AutoSetupOptions(), ct).ConfigureAwait(false);
        return Ok(new
        {
            ok = steps.All(s => s.Ok),
            steps = steps.Select(s => new { step = s.Step, ok = s.Ok, message = s.Message })
        });
    }
}
