namespace Feedarr.Api.Services.AppHub;

/// <summary>Known applications of the all-in-one stack and their defaults.</summary>
public sealed record AppDefinition(
    string Type,
    string Name,
    int DefaultPort,
    string HealthPath,
    string ConfigFolder,
    string DockerService);

public static class AppCatalog
{
    public static readonly IReadOnlyList<AppDefinition> All = new[]
    {
        new AppDefinition("seerr",       "Seerr",       5055, "/api/v1/status", "seerr",       "seerr"),
        new AppDefinition("prowlarr",    "Prowlarr",    9696, "/ping",          "prowlarr",    "prowlarr"),
        new AppDefinition("sonarr",      "Sonarr",      8989, "/ping",          "sonarr",      "sonarr"),
        new AppDefinition("radarr",      "Radarr",      7878, "/ping",          "radarr",      "radarr"),
        new AppDefinition("tautulli",    "Tautulli",    8181, "/status",        "tautulli",    "tautulli"),
        new AppDefinition("qbittorrent", "qBittorrent", 8090, "/",              "qbittorrent", "qbittorrent"),
    };

    public static AppDefinition? Find(string? type)
        => All.FirstOrDefault(a => string.Equals(a.Type, type?.Trim(), StringComparison.OrdinalIgnoreCase));

    public static bool IsKnownType(string? type)
        => string.Equals(type?.Trim(), "custom", StringComparison.OrdinalIgnoreCase) || Find(type) is not null;
}
