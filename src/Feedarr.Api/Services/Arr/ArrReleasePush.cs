using System.Text.Json.Serialization;

namespace Feedarr.Api.Services.Arr;

/// <summary>
/// Body of Sonarr / Radarr <c>POST /api/v3/release/push</c>.
/// The arr app parses the title, evaluates it against its quality profile and
/// grabs it with its download client when approved.
/// </summary>
public sealed class ArrReleasePushRequest
{
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("downloadUrl")] public string? DownloadUrl { get; set; }
    [JsonPropertyName("magnetUrl")] public string? MagnetUrl { get; set; }
    [JsonPropertyName("infoUrl")] public string? InfoUrl { get; set; }
    [JsonPropertyName("guid")] public string? Guid { get; set; }
    [JsonPropertyName("size")] public long? Size { get; set; }
    [JsonPropertyName("seeders")] public int? Seeders { get; set; }
    [JsonPropertyName("leechers")] public int? Leechers { get; set; }
    [JsonPropertyName("indexer")] public string? Indexer { get; set; }
    [JsonPropertyName("protocol")] public string Protocol { get; set; } = "torrent";
    [JsonPropertyName("downloadProtocol")] public string DownloadProtocol { get; set; } = "torrent";
    [JsonPropertyName("publishDate")] public string PublishDate { get; set; } = "";
    [JsonPropertyName("tmdbId")] public int? TmdbId { get; set; }
    [JsonPropertyName("tvdbId")] public int? TvdbId { get; set; }
}

public sealed record ArrReleasePushResult(
    bool Ok,
    bool Approved,
    bool Rejected,
    bool TemporarilyRejected,
    IReadOnlyList<string> Rejections,
    string? Error);

internal sealed class ArrReleasePushResponseItem
{
    [JsonPropertyName("approved")] public bool Approved { get; set; }
    [JsonPropertyName("rejected")] public bool Rejected { get; set; }
    [JsonPropertyName("temporarilyRejected")] public bool TemporarilyRejected { get; set; }
    [JsonPropertyName("rejections")] public List<string>? Rejections { get; set; }
}

internal static class ArrReleasePushParser
{
    public static ArrReleasePushResult Parse(string json)
    {
        var trimmed = (json ?? "").TrimStart();
        List<ArrReleasePushResponseItem>? items;
        if (trimmed.StartsWith('['))
        {
            items = System.Text.Json.JsonSerializer.Deserialize<List<ArrReleasePushResponseItem>>(trimmed);
        }
        else if (trimmed.StartsWith('{'))
        {
            var single = System.Text.Json.JsonSerializer.Deserialize<ArrReleasePushResponseItem>(trimmed);
            items = single is null ? null : new List<ArrReleasePushResponseItem> { single };
        }
        else
        {
            items = null;
        }

        var first = items?.FirstOrDefault();
        if (first is null)
            return new ArrReleasePushResult(true, false, false, false, Array.Empty<string>(), null);

        var rejections = (first.Rejections ?? new List<string>())
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .ToList();
        return new ArrReleasePushResult(
            Ok: true,
            Approved: first.Approved && !first.Rejected,
            Rejected: first.Rejected,
            TemporarilyRejected: first.TemporarilyRejected,
            Rejections: rejections,
            Error: null);
    }
}
