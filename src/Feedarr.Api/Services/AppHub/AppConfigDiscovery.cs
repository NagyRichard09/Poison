using System.Text.Json;
using System.Xml;

namespace Feedarr.Api.Services.AppHub;

/// <summary>What was found in an application's config folder.</summary>
public sealed record DiscoveredApp(
    string Type,
    string Name,
    string ConfigPath,
    int Port,
    string? UrlBase,
    string? ApiKey)
{
    public bool HasApiKey => !string.IsNullOrWhiteSpace(ApiKey);
}

/// <summary>
/// Reads API keys / ports from the config folders of the other apps, mounted read-only
/// into the Feedarr container (all-in-one stack: /appconfig/&lt;app&gt;):
///   Sonarr / Radarr / Prowlarr : config.xml        → &lt;ApiKey&gt;, &lt;Port&gt;, &lt;UrlBase&gt;
///   Seerr                      : settings.json     → main.apiKey
///   Tautulli                   : config.ini        → [General] http_port, api_key, http_root
///   qBittorrent                : qBittorrent/qBittorrent.conf → WebUI\Port
///   Plex                       : Library/Application Support/Plex Media Server/Preferences.xml → PlexOnlineToken
/// </summary>
public static class AppConfigDiscovery
{
    private const long MaxConfigBytes = 2 * 1024 * 1024;

    public static List<DiscoveredApp> Discover(string root, ILogger? log = null)
    {
        var result = new List<DiscoveredApp>();
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return result;

        foreach (var def in AppCatalog.All)
        {
            var dir = Path.Combine(root, def.ConfigFolder);
            if (!Directory.Exists(dir)) continue;

            try
            {
                var found = def.Type switch
                {
                    "sonarr" or "radarr" or "prowlarr" => ReadArrConfig(def, dir),
                    "seerr" => ReadSeerrConfig(def, dir),
                    "tautulli" => ReadTautulliConfig(def, dir),
                    "qbittorrent" => ReadQbittorrentConfig(def, dir),
                    "plex" => ReadPlexConfig(def, dir),
                    _ => null
                };
                if (found is not null) result.Add(found);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or XmlException or JsonException)
            {
                log?.LogWarning(ex, "App discovery: could not read {Type} config in {Dir}", def.Type, dir);
                result.Add(new DiscoveredApp(def.Type, def.Name, dir, def.DefaultPort, null, null));
            }
        }

        return result;
    }

    internal static DiscoveredApp? ReadArrConfig(AppDefinition def, string dir)
    {
        var file = Path.Combine(dir, "config.xml");
        if (!File.Exists(file)) return new DiscoveredApp(def.Type, def.Name, dir, def.DefaultPort, null, null);
        return ParseArrConfigXml(def, file, ReadSmallFile(file));
    }

    internal static DiscoveredApp ParseArrConfigXml(AppDefinition def, string path, string xml)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
        using var reader = XmlReader.Create(new StringReader(xml), settings);
        var doc = new XmlDocument { XmlResolver = null };
        doc.Load(reader);

        string? Value(string name) => doc.DocumentElement?[name]?.InnerText?.Trim();
        var port = int.TryParse(Value("Port"), out var p) && p is > 0 and < 65536 ? p : def.DefaultPort;
        var urlBase = NormalizeUrlBase(Value("UrlBase"));
        var apiKey = Value("ApiKey");
        return new DiscoveredApp(def.Type, def.Name, path, port, urlBase, string.IsNullOrWhiteSpace(apiKey) ? null : apiKey);
    }

    internal static DiscoveredApp ReadSeerrConfig(AppDefinition def, string dir)
    {
        var file = Path.Combine(dir, "settings.json");
        if (!File.Exists(file)) return new DiscoveredApp(def.Type, def.Name, dir, def.DefaultPort, null, null);
        return ParseSeerrSettingsJson(def, file, ReadSmallFile(file));
    }

    internal static DiscoveredApp ParseSeerrSettingsJson(AppDefinition def, string path, string json)
    {
        using var doc = JsonDocument.Parse(json);
        string? apiKey = null;
        if (doc.RootElement.TryGetProperty("main", out var main) &&
            main.ValueKind == JsonValueKind.Object &&
            main.TryGetProperty("apiKey", out var key) &&
            key.ValueKind == JsonValueKind.String)
        {
            apiKey = key.GetString();
        }
        return new DiscoveredApp(def.Type, def.Name, path, def.DefaultPort, null, string.IsNullOrWhiteSpace(apiKey) ? null : apiKey);
    }

    internal static DiscoveredApp ReadTautulliConfig(AppDefinition def, string dir)
    {
        var file = Path.Combine(dir, "config.ini");
        if (!File.Exists(file)) return new DiscoveredApp(def.Type, def.Name, dir, def.DefaultPort, null, null);
        return ParseTautulliIni(def, file, ReadSmallFile(file));
    }

    internal static DiscoveredApp ParseTautulliIni(AppDefinition def, string path, string ini)
    {
        var values = ParseIniSection(ini, "General");
        var port = values.TryGetValue("http_port", out var ps) && int.TryParse(ps, out var p) && p is > 0 and < 65536
            ? p : def.DefaultPort;
        values.TryGetValue("api_key", out var apiKey);
        values.TryGetValue("http_root", out var root);
        return new DiscoveredApp(def.Type, def.Name, path, port, NormalizeUrlBase(root),
            string.IsNullOrWhiteSpace(apiKey) ? null : apiKey);
    }

    internal static DiscoveredApp ReadQbittorrentConfig(AppDefinition def, string dir)
    {
        // "--profile=<dir>" layout first, then the classic ~/.config layout.
        var file = new[]
            {
                Path.Combine(dir, "qBittorrent", "config", "qBittorrent.conf"),
                Path.Combine(dir, "qBittorrent", "qBittorrent.conf"),
            }
            .FirstOrDefault(File.Exists);
        if (file is null) return new DiscoveredApp(def.Type, def.Name, dir, def.DefaultPort, null, null);
        var values = ParseIniSection(ReadSmallFile(file), "Preferences");
        var port = values.TryGetValue(@"WebUI\Port", out var ps) && int.TryParse(ps, out var p) && p is > 0 and < 65536
            ? p : def.DefaultPort;
        return new DiscoveredApp(def.Type, def.Name, file, port, null, null);
    }

    internal static DiscoveredApp ReadPlexConfig(AppDefinition def, string dir)
    {
        var file = new[]
            {
                Path.Combine(dir, "Library", "Application Support", "Plex Media Server", "Preferences.xml"),
                Path.Combine(dir, "Plex Media Server", "Preferences.xml"),
            }
            .FirstOrDefault(File.Exists);
        if (file is null) return new DiscoveredApp(def.Type, def.Name, dir, def.DefaultPort, null, null);
        return ParsePlexPreferencesXml(def, file, ReadSmallFile(file));
    }

    /// <summary>&lt;Preferences PlexOnlineToken="…" ManualPortMappingPort="…" /&gt; – the token exists once the server is claimed.</summary>
    internal static DiscoveredApp ParsePlexPreferencesXml(AppDefinition def, string path, string xml)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
        using var reader = XmlReader.Create(new StringReader(xml), settings);
        var doc = new XmlDocument { XmlResolver = null };
        doc.Load(reader);
        var token = doc.DocumentElement?.GetAttribute("PlexOnlineToken")?.Trim();
        return new DiscoveredApp(def.Type, def.Name, path, def.DefaultPort, null, string.IsNullOrWhiteSpace(token) ? null : token);
    }

    internal static Dictionary<string, string> ParseIniSection(string ini, string section)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var inSection = false;
        foreach (var raw in ini.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#') || line.StartsWith(';')) continue;
            if (line.StartsWith('[') && line.EndsWith(']'))
            {
                inSection = string.Equals(line[1..^1].Trim(), section, StringComparison.OrdinalIgnoreCase);
                continue;
            }
            if (!inSection) continue;
            var eq = line.IndexOf('=');
            if (eq <= 0) continue;
            var key = line[..eq].Trim();
            var value = line[(eq + 1)..].Trim().Trim('"');
            values[key] = value;
        }
        return values;
    }

    private static string? NormalizeUrlBase(string? urlBase)
    {
        var s = (urlBase ?? "").Trim().Trim('/');
        return s.Length == 0 ? null : "/" + s;
    }

    private static string ReadSmallFile(string file)
    {
        var info = new FileInfo(file);
        if (info.Length > MaxConfigBytes) throw new IOException($"Config file too large: {file}");
        return File.ReadAllText(file);
    }
}
