using System.Net;
using Feedarr.Api.Models.Settings;
using Feedarr.Api.Services.AppHub;
using Feedarr.Api.Services.DiskSpace;

namespace Feedarr.Api.Tests;

public sealed class AppHubAndDiskSpaceTests
{
    private static AppDefinition Def(string type) => AppCatalog.Find(type)!;

    [Fact]
    public void ArrConfigXml_ApiKeyPortAndUrlBase_AreRead()
    {
        const string xml = "<Config><Port>7878</Port><UrlBase>/radarr/</UrlBase><ApiKey>abc123</ApiKey></Config>";
        var app = AppConfigDiscovery.ParseArrConfigXml(Def("radarr"), "/x/config.xml", xml);

        Assert.Equal(7878, app.Port);
        Assert.Equal("/radarr", app.UrlBase);
        Assert.Equal("abc123", app.ApiKey);
    }

    [Fact]
    public void ArrConfigXml_WithDtd_IsRejected()
    {
        const string xml = """<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Config><ApiKey>&e;</ApiKey></Config>""";
        Assert.ThrowsAny<System.Xml.XmlException>(() =>
            AppConfigDiscovery.ParseArrConfigXml(Def("prowlarr"), "/x/config.xml", xml));
    }

    [Fact]
    public void SeerrSettingsJson_MainApiKey_IsRead()
    {
        var app = AppConfigDiscovery.ParseSeerrSettingsJson(Def("seerr"), "/x/settings.json",
            """{"main":{"apiKey":"seerr-key"}}""");
        Assert.Equal("seerr-key", app.ApiKey);
        Assert.Equal(5055, app.Port);
    }

    [Fact]
    public void TautulliIni_GeneralSectionOnly()
    {
        var app = AppConfigDiscovery.ParseTautulliIni(Def("tautulli"), "/x/config.ini",
            "[General]\nhttp_port = 8282\napi_key = good\n[Other]\napi_key = wrong\n");
        Assert.Equal(8282, app.Port);
        Assert.Equal("good", app.ApiKey);
    }

    [Theory]
    [InlineData("DENY", false)]
    [InlineData("SAMEORIGIN", false)]
    public void XFrameOptions_BlocksEmbedding(string value, bool expected)
    {
        var resp = new HttpResponseMessage(HttpStatusCode.OK);
        resp.Headers.TryAddWithoutValidation("X-Frame-Options", value);
        Assert.Equal(expected, AppHubService.EvaluateEmbeddable(resp));
    }

    [Fact]
    public void NoFrameHeaders_AllowsEmbedding()
    {
        Assert.True(AppHubService.EvaluateEmbeddable(new HttpResponseMessage(HttpStatusCode.OK)));
    }

    [Theory]
    [InlineData("http://{host}:8989", true)]
    [InlineData("https://sonarr.example.com/base", true)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("ftp://x", false)]
    [InlineData("", false)]
    public void LinkUrls_AreValidated(string url, bool expected)
    {
        Assert.Equal(expected, AppHubService.IsValidLinkUrl(url));
    }

    [Fact]
    public void SeerrWebhookTemplate_IsValidJson()
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(AppHubService.SeerrWebhookTemplate);
        Assert.NotNull(node);
    }

    [Fact]
    public void MountTable_FindsMostSpecificMountPoint()
    {
        var table = MountTable.Parse(new[]
        {
            "28 1 254:0 / / rw,relatime - ext4 /dev/vda rw",
            "40 28 0:50 / /srv/media rw,relatime - nfs nas:/media rw",
            "41 28 0:51 / /srv/media\\040disk rw,relatime - ext4 /dev/vdb rw",
        }, mountInfo: true);

        Assert.Equal("/srv/media", table.FindMountPoint("/srv/media/tv")!.MountPoint);
        Assert.Equal("/", table.FindMountPoint("/var/lib/feedarr")!.MountPoint);
        Assert.Equal("/srv/media disk", table.FindMountPoint("/srv/media disk/x")!.MountPoint);
        Assert.Equal("/", table.FindMountPoint("/srv/mediaother")!.MountPoint);
    }

    [Fact]
    public void LowSpace_PercentAndGbThresholds()
    {
        var gb = 1024L * 1024 * 1024;
        Assert.True(DiskSpaceService.IsLow(5 * gb, 100 * gb, new DiskSpaceSettings { WarnFreePercent = 10 }));
        Assert.False(DiskSpaceService.IsLow(20 * gb, 100 * gb, new DiskSpaceSettings { WarnFreePercent = 10 }));
        Assert.True(DiskSpaceService.IsLow(40 * gb, 1000 * gb, new DiskSpaceSettings { WarnFreePercent = 0, WarnFreeGb = 50 }));
        Assert.False(DiskSpaceService.IsLow(40 * gb, 100 * gb, new DiskSpaceSettings { WarnFreePercent = 0, WarnFreeGb = 0 }));
    }

    [Fact]
    public void PlexPreferences_TokenIsRead_AndMissingTokenMeansUnclaimed()
    {
        const string claimed = """<?xml version="1.0" encoding="utf-8"?><Preferences MachineIdentifier="m1" PlexOnlineToken="tok-123" allowedNetworks="127.0.0.1/255.255.255.255"/>""";
        var app = AppConfigDiscovery.ParsePlexPreferencesXml(Def("plex"), "/x/Preferences.xml", claimed);
        Assert.Equal("tok-123", app.ApiKey);
        Assert.Equal(32400, app.Port);

        const string fresh = """<?xml version="1.0" encoding="utf-8"?><Preferences MachineIdentifier="m1"/>""";
        Assert.Null(AppConfigDiscovery.ParsePlexPreferencesXml(Def("plex"), "/x/Preferences.xml", fresh).ApiKey);
    }

    [Theory]
    [InlineData("""{"MediaContainer":{"claimed":true}}""", true)]
    [InlineData("""{"MediaContainer":{"claimed":"1"}}""", true)]
    [InlineData("""{"MediaContainer":{"claimed":false}}""", false)]
    [InlineData("""{"MediaContainer":{}}""", false)]
    public void PlexIdentity_ClaimedFlag(string json, bool expected)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(json) as System.Text.Json.Nodes.JsonObject;
        Assert.Equal(expected, StackSetupService.PlexClaimed(node));
    }

    [Fact]
    public void PlexLink_OpensPlexWebInNewTab()
    {
        var link = AppHubService.BuildDefaultLink(Def("plex"));
        Assert.Equal("http://{host}:32400/web", link.Url);
        Assert.Equal("http://127.0.0.1:32400", link.InternalUrl);
        Assert.Equal("tab", link.OpenMode);
    }
}
