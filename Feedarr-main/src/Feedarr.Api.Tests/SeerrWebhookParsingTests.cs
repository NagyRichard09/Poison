using System.Text.Json;
using Feedarr.Api.Controllers;
using Feedarr.Api.Services.Arr;
using Feedarr.Api.Services.Seerr;

namespace Feedarr.Api.Tests;

public sealed class SeerrWebhookParsingTests
{
    private static readonly JsonSerializerOptions WebOpts = new(JsonSerializerDefaults.Web);

    [Fact]
    public void DefaultSeerrTemplate_WithStringIds_IsParsed()
    {
        const string json = """
        {
          "notification_type": "MEDIA_AUTO_APPROVED",
          "subject": "The Last of Us (2023)",
          "image": "https://image.tmdb.org/t/p/w600_and_h900_bestv2/poster.jpg",
          "media": { "media_type": "tv", "tmdbId": "100088", "tvdbId": "", "status": "PENDING" },
          "request": { "request_id": "5", "requestedBy_username": "richard" },
          "issue": null,
          "extra": [ { "name": "Requested Seasons", "value": "1, 2" } ]
        }
        """;

        var payload = JsonSerializer.Deserialize<SeerrWebhookController.SeerrPayloadDto>(json, WebOpts)!.ToServicePayload();

        Assert.Equal("MEDIA_AUTO_APPROVED", payload.NotificationType);
        Assert.Equal("100088", payload.Media!.TmdbId);
        Assert.Null(payload.Media.TvdbId);
        Assert.Equal("5", payload.Request!.RequestId);
        Assert.Equal("https://image.tmdb.org/t/p/w600_and_h900_bestv2/poster.jpg", payload.Image);
        var extra = Assert.Single(payload.Extra!);
        Assert.Equal("Requested Seasons", extra.Key);
        Assert.Equal("1, 2", extra.Value);
    }

    [Fact]
    public void NumericIds_AndOddExtraShapes_DoNotFail()
    {
        const string json = """
        { "notification_type": "MEDIA_APPROVED", "extra": {},
          "media": { "media_type": "movie", "tmdbId": 693134 }, "request": { "request_id": 7 } }
        """;

        var dto = JsonSerializer.Deserialize<SeerrWebhookController.SeerrPayloadDto>(json, WebOpts)!;

        Assert.Equal("693134", dto.Media!.TmdbId);
        Assert.Equal("7", dto.Request!.RequestId);
        Assert.Null(dto.Extra);
    }

    [Theory]
    [InlineData("1, 2", "1,2")]
    [InlineData("Season 3, Season 1", "1,3")]
    [InlineData("2,2,2", "2")]
    [InlineData("", "")]
    public void ParseSeasons_NormalizesInput(string raw, string expected)
    {
        Assert.Equal(expected, string.Join(",", SeerrWebhookService.ParseSeasons(raw)));
    }

    [Fact]
    public void SubjectYear_IsExtractedAndStripped()
    {
        Assert.Equal(2021, SeerrWebhookService.ExtractYear("Dune (2021)"));
        Assert.Equal("Dune", SeerrWebhookService.StripYear("Dune (2021)"));
        Assert.Equal("1917", SeerrWebhookService.StripYear("1917"));
    }

    [Fact]
    public void ArrPushResponse_RejectedWithReasons_IsParsed()
    {
        var result = ArrReleasePushParser.Parse(
            """[{"approved":false,"rejected":true,"temporarilyRejected":false,"rejections":["Episode is not monitored"]}]""");

        Assert.True(result.Ok);
        Assert.False(result.Approved);
        Assert.True(result.Rejected);
        Assert.Equal("Episode is not monitored", Assert.Single(result.Rejections));
    }

    [Fact]
    public void ArrPushResponse_Approved_IsParsed()
    {
        var result = ArrReleasePushParser.Parse("""[{"approved":true,"rejected":false,"rejections":[]}]""");
        Assert.True(result.Approved);
        Assert.Empty(result.Rejections);
    }
}
