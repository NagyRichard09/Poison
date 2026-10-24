using System.Text.RegularExpressions;

namespace Feedarr.Api.Services.Matching;

/// <summary>
/// Detects Hungarian subtitle/audio tags in torrent release names and normalises
/// Hungarian alternative titles so they can be matched to TMDB entries.
///
/// Recognised Hungarian markers (case-insensitive):
///   Audio/sub:  HUN, HUNSUB, HUNDUL, HUNDK, MULTi (when paired with HU),
///               MAGYAR, FELIRATOS, SZINKRONOS, DUAL.HUN, DL.HUN
///   Tracker:    nCore, BitHUmen, PORT.hu style filenames
/// </summary>
public static class HungarianTitleNormalizer
{
    // ------------------------------------------------------------------ //
    // HUN tag detection
    // ------------------------------------------------------------------ //

    /// <summary>
    /// Returns true when the release title contains a recognised Hungarian marker.
    /// </summary>
    public static bool HasHungarianTag(string? releaseName)
    {
        if (string.IsNullOrWhiteSpace(releaseName)) return false;
        return HunTagRegex.IsMatch(releaseName);
    }

    // Matches common Hungarian audio/subtitle markers, word-boundary aware
    private static readonly Regex HunTagRegex = new(
        @"(?<![A-Za-z])(HUN(SUB|DUL|DK)?|HUNSUB|HUNDUL|HUNDK|MAGYAR|FELIRATOS|SZINKRONOS|" +
        @"(?:DUAL|DL)[\.\-]HUN|HUN[\.\-](?:DUAL|DL)|MULTi[\.\-]?HU|HU[\.\-]?MULTi)" +
        @"(?![A-Za-z])",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ------------------------------------------------------------------ //
    // Title normalisation for lookup
    // ------------------------------------------------------------------ //

    /// <summary>
    /// Normalises a Hungarian title candidate to a canonical lookup key.
    /// Strips accents, lowercases, collapses whitespace — same transform applied
    /// to both the TMDB alternative title and the parsed release title so they
    /// can be compared as strings.
    /// </summary>
    public static string NormalizeForLookup(string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return string.Empty;

        // Remove Hungarian articles at the start ("A ", "Az ")
        var s = LeadingArticleRegex.Replace(title.Trim(), "");

        // Collapse separators (dots, underscores, dashes) to spaces
        s = SeparatorRegex.Replace(s, " ");

        // Strip accents (á→a, ő→o, ű→u, ...) as documented
        s = RemoveDiacritics(s);

        // Strip non-alphanumeric except spaces
        s = NonAlphanumRegex.Replace(s, " ");

        // Collapse whitespace
        s = WhitespaceRegex.Replace(s.Trim(), " ");

        return s.ToLowerInvariant();
    }

    private static string RemoveDiacritics(string value)
    {
        var decomposed = value.Normalize(System.Text.NormalizationForm.FormD);
        var sb = new System.Text.StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) != System.Globalization.UnicodeCategory.NonSpacingMark)
                sb.Append(ch);
        }
        return sb.ToString().Normalize(System.Text.NormalizationForm.FormC);
    }

    private static readonly Regex LeadingArticleRegex =
        new(@"^(?:Az?)\s+", RegexOptions.Compiled);

    private static readonly Regex SeparatorRegex =
        new(@"[._\-]+", RegexOptions.Compiled);

    private static readonly Regex NonAlphanumRegex =
        new(@"[^\w\s]", RegexOptions.Compiled);

    private static readonly Regex WhitespaceRegex =
        new(@"\s+", RegexOptions.Compiled);

    // ------------------------------------------------------------------ //
    // Release name parser helpers
    // ------------------------------------------------------------------ //

    /// <summary>
    /// Strips quality/format tokens from a release name and returns the bare title segment.
    /// Works on both dot-separated (nCore style) and space-separated names.
    /// Example: "A.Csillagok.Kozott.2014.1080p.BluRay.HUN" → "A Csillagok Kozott 2014"
    /// </summary>
    public static string StripTechTokens(string releaseName)
    {
        if (string.IsNullOrWhiteSpace(releaseName)) return string.Empty;

        // Split on dots, spaces or underscores
        var parts = releaseName.Split(new[] { '.', ' ', '_' }, StringSplitOptions.RemoveEmptyEntries);
        var result = new List<string>();

        foreach (var part in parts)
        {
            // A year ends the title but is kept for the search query.
            // A leading year is part of the title itself (e.g. "1917.2019.1080p").
            if (YearTokenRegex.IsMatch(part))
            {
                if (result.Count == 0)
                {
                    result.Add(part);
                    continue;
                }

                result.Add(part);
                break;
            }

            // Stop at known tech/quality tokens (whole-token match only, so that
            // words like "Hunger", "Multiverse" or "Dune" are not mistaken for tags).
            if (TechTokenRegex.IsMatch(part)) break;
            result.Add(part);
        }

        return string.Join(" ", result);
    }

    private static readonly Regex YearTokenRegex = new(
        @"^\(?(19|20)\d{2}\)?$",
        RegexOptions.Compiled);

    // Tokens are produced by splitting on '.', ' ' and '_', so multi-part markers
    // like "DD5.1" or "H.264" arrive as separate tokens ("DD5", "H", "264").
    private static readonly Regex TechTokenRegex = new(
        @"^(?:" +
        @"[0-9]{3,4}[pi]|"                                    + // resolution: 720p, 1080i, 2160p
        @"4k|uhd|"                                            +
        @"blu-?ray|bdrip|brrip|bdremux|"                      +
        @"web-?dl|webrip|web|hdtv|amzn|nf|dsnp|hmax|atvp|"    +
        @"dvdrip|dvdscr|dvd|"                                 +
        @"x264|x265|h264|h265|hevc|avc|xvid|divx|"            +
        @"dts|dd5|ddp5|dd|ddp|ac3|aac|atmos|truehd|flac|mp3|" +
        @"hun|hunsub|hundul|hundk|magyar|feliratos|szinkronos|" +
        @"multi|dual|dl|"                                     +
        @"proper|repack|extended|theatrical|"                 +
        @"remux|hdr|hdr10|dv|dolby|"                          +
        @"s\d{1,2}(?:e\d{1,3})*|season|evad"                  + // S01, S01E01, season markers
        @")(?:-[A-Za-z0-9]+)?$",                                 // optional "-GROUP" suffix
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
}
