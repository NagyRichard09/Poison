using Feedarr.Api.Services.AppHub;
using Microsoft.AspNetCore.Mvc;

namespace Feedarr.Api.Controllers;

/// <summary>
/// First-run "stack setup" wizard: Radarr → Sonarr → Prowlarr → Seerr → qBittorrent → Tautulli → Feedarr.
/// </summary>
[ApiController]
[Route("api/stack-setup")]
public sealed class StackSetupController : ControllerBase
{
    private readonly StackSetupService _stack;

    public StackSetupController(StackSetupService stack)
    {
        _stack = stack;
    }

    // Allowed before Feedarr security is configured (read-only): the wizard needs it to decide where to start.
    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
        => Ok(await _stack.GetStatusAsync(ct).ConfigureAwait(false));

    [HttpPost("plex")]
    public async Task<IActionResult> Plex([FromBody] StackSetupService.PlexStepRequest? req, CancellationToken ct)
        => Ok(Wrap(await _stack.SetupPlexAsync(req ?? new(), ct).ConfigureAwait(false)));

    [HttpPost("radarr")]
    public async Task<IActionResult> Radarr([FromBody] StackSetupService.ArrStepRequest? req, CancellationToken ct)
        => Ok(Wrap(await _stack.SetupArrAsync("radarr", req ?? new(), ct).ConfigureAwait(false)));

    [HttpPost("sonarr")]
    public async Task<IActionResult> Sonarr([FromBody] StackSetupService.ArrStepRequest? req, CancellationToken ct)
        => Ok(Wrap(await _stack.SetupArrAsync("sonarr", req ?? new(), ct).ConfigureAwait(false)));

    [HttpPost("prowlarr")]
    public async Task<IActionResult> Prowlarr([FromBody] StackSetupService.ProwlarrStepRequest? req, CancellationToken ct)
        => Ok(Wrap(await _stack.SetupProwlarrAsync(req ?? new(), ct).ConfigureAwait(false)));

    [HttpPost("seerr")]
    public async Task<IActionResult> Seerr([FromBody] StackSetupService.SeerrStepRequest? req, CancellationToken ct)
        => Ok(Wrap(await _stack.SetupSeerrAsync(req ?? new(), ct).ConfigureAwait(false)));

    [HttpPost("qbittorrent")]
    public async Task<IActionResult> Qbittorrent([FromBody] StackSetupService.QbittorrentStepRequest? req, CancellationToken ct)
        => Ok(Wrap(await _stack.SetupQbittorrentAsync(req ?? new(), ct).ConfigureAwait(false)));

    [HttpPost("tautulli")]
    public async Task<IActionResult> Tautulli(CancellationToken ct)
        => Ok(Wrap(await _stack.CheckTautulliAsync(ct).ConfigureAwait(false)));

    [HttpPost("finish")]
    public async Task<IActionResult> Finish(CancellationToken ct)
        => Ok(Wrap(await _stack.FinishAsync(ct).ConfigureAwait(false)));

    private static object Wrap(List<StackSetupService.StepResult> steps) => new
    {
        ok = steps.All(s => s.Ok),
        steps = steps.Select(s => new { step = s.Step, ok = s.Ok, message = s.Message })
    };
}
