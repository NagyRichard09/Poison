namespace Feedarr.Api.Options;

public sealed class UpdatesOptions
{
    public bool Enabled { get; set; } = true;
    public string RepoOwner { get; set; } = "NagyRichard09";
    public string RepoName { get; set; } = "Poison";
    public int CheckIntervalHours { get; set; } = 6;
    public int TimeoutSeconds { get; set; } = 10;
    public bool AllowPrerelease { get; set; } = false;
    public string GitHubApiBaseUrl { get; set; } = "https://api.github.com";
    public string? GitHubToken { get; set; }
}
