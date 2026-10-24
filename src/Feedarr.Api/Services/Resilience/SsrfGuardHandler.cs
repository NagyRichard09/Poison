using Feedarr.Api.Services.Security;

namespace Feedarr.Api.Services.Resilience;

/// <summary>
/// DelegatingHandler that resolves the target hostname via DNS before every outbound
/// HTTP request and blocks the call if any resolved IP falls within a private or
/// restricted range (RFC 1918, link-local, loopback, ULA, etc.).
///
/// This guards against DNS-rebinding SSRF attacks: a URL that passes static validation
/// at save time (because the host looked public) but later resolves to an internal IP.
///
/// Apply to HTTP clients whose base URL is user-configured:
///   TorznabClient, JackettClient, ProwlarrClient, SonarrClient, RadarrClient, EerrRequestClient.
///
/// Do NOT apply to clients with a hardcoded base address (TMDB, TVmaze, etc.) — there is
/// no user-controlled URL to rebind.
/// </summary>
internal sealed class SsrfGuardHandler : DelegatingHandler
{
    /// <summary>
    /// Set this option on a request to bypass the private-IP SSRF check.
    /// Use only for provider clients (Prowlarr, Jackett, Torznab) that are
    /// intentionally deployed on the local network or loopback.
    /// </summary>
    internal static readonly HttpRequestOptionsKey<bool> AllowPrivateHostOption =
        new("feedarr.allow_private_host");

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var uri = request.RequestUri;
        if (uri is not null &&
            (uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) ||
             uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)))
        {
            // Provider clients (Prowlarr, Jackett, Torznab) are intentionally local/LAN.
            // They opt out of the private-IP block via this request option.
            request.Options.TryGetValue(AllowPrivateHostOption, out var allowPrivate);
            if (!allowPrivate)
            {
                var (allowed, error) = await OutboundUrlGuard
                    .ValidateOutboundHostAsync(uri.Host, cancellationToken)
                    .ConfigureAwait(false);

                if (!allowed)
                {
                    // Return a synthetic 403 so callers get a clear, loggable failure
                    // rather than a misleading network error.
                    var blocked = new HttpResponseMessage(System.Net.HttpStatusCode.Forbidden)
                    {
                        ReasonPhrase = "SSRF blocked",
                        Content = new StringContent(
                            $"Request to '{uri.Host}' was blocked by the SSRF guard: {error}",
                            System.Text.Encoding.UTF8,
                            "text/plain")
                    };
                    return blocked;
                }
            }
        }

        return await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
    }
}
