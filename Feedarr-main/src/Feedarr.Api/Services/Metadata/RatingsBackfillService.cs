using Dapper;
using Feedarr.Api.Data;
using Feedarr.Api.Services.Omdb;

namespace Feedarr.Api.Services.Metadata;

/// <summary>
/// Background-callable service that fills IMDb / Rotten Tomatoes / Metascore
/// ratings from OMDb for releases that already have an IMDb ID but no ratings yet
/// (ext_ratings_fetched_at IS NULL).
///
/// Each IMDb ID is fetched once: the result is written to every release sharing the
/// same IMDb ID / media entity. Transient failures (network, quota, invalid key) are
/// not cached so they are retried on a later run; a quota/auth error stops the batch.
/// Batch size: configurable (default 50 per run) to stay within OMDb free-tier
/// 1 000 req/day limit.
/// </summary>
public sealed class RatingsBackfillService
{
    private readonly Db _db;
    private readonly OmdbClient _omdb;
    private readonly ILogger<RatingsBackfillService> _log;

    public RatingsBackfillService(Db db, OmdbClient omdb, ILogger<RatingsBackfillService> log)
    {
        _db   = db;
        _omdb = omdb;
        _log  = log;
    }

    public sealed record Result(int Processed, int Updated, int Errors);

    /// <summary>True when the OMDb provider is enabled and has an API key.</summary>
    public bool IsEnabled() => _omdb.IsConfigured();

    // ------------------------------------------------------------------ //
    // Public entry points
    // ------------------------------------------------------------------ //

    /// <summary>
    /// Processes up to <paramref name="limit"/> releases that have an IMDb ID
    /// but no cached ratings yet.
    /// </summary>
    public async Task<Result> BackfillAsync(int limit, CancellationToken ct)
    {
        var lim  = Math.Clamp(limit <= 0 ? 50 : limit, 1, 500);
        if (!_omdb.IsConfigured()) return new Result(0, 0, 0);
        var rows = GetPendingRows(lim);
        if (rows.Count == 0) return new Result(0, 0, 0);

        var processed = 0;
        var updated   = 0;
        var errors    = 0;

        foreach (var row in rows)
        {
            ct.ThrowIfCancellationRequested();
            processed++;

            try
            {
                var ratings = await _omdb.GetByImdbIdAsync(row.ImdbId, ct).ConfigureAwait(false);
                var ts      = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

                if (ratings is not null)
                {
                    ApplyRatings(row.ReleaseId, row.EntityId, row.ImdbId, ratings, ts);
                    updated++;
                }
                else
                {
                    // Mark as attempted so we don't retry every run
                    MarkFetched(row.ReleaseId, row.EntityId, row.ImdbId, ts);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (OmdbClient.OmdbUnavailableException ex) when (ex.IsQuotaOrAuthError)
            {
                _log.LogWarning(
                    "OMDb ratings backfill stopped: {Error} (releaseId={ReleaseId})",
                    ex.Message, row.ReleaseId);
                errors++;
                break;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex,
                    "OMDb ratings backfill failed for releaseId={ReleaseId} imdbId={ImdbId}",
                    row.ReleaseId, row.ImdbId);
                errors++;
            }
        }

        return new Result(processed, updated, errors);
    }

    // ------------------------------------------------------------------ //
    // DB helpers
    // ------------------------------------------------------------------ //

    private sealed class PendingRow
    {
        public long   ReleaseId { get; init; }
        public long?  EntityId  { get; init; }
        public string ImdbId    { get; init; } = "";
        public long?  LastPublishedAt { get; init; }
    }

    private List<PendingRow> GetPendingRows(int limit)
    {
        using var conn = _db.Open();
        return conn.Query<PendingRow>(
            """
            SELECT MAX(r.id) AS ReleaseId,
                   MAX(r.entity_id) AS EntityId,
                   COALESCE(NULLIF(TRIM(r.ext_imdb_id), ''), NULLIF(TRIM(me.ext_imdb_id), ''), NULLIF(TRIM(me.imdb_id), '')) AS ImdbId,
                   MAX(r.published_at_ts) AS LastPublishedAt
            FROM releases r
            LEFT JOIN media_entities me ON me.id = r.entity_id
            WHERE COALESCE(NULLIF(TRIM(r.ext_imdb_id), ''), NULLIF(TRIM(me.ext_imdb_id), ''), NULLIF(TRIM(me.imdb_id), '')) IS NOT NULL
              AND r.ext_ratings_fetched_at IS NULL
            GROUP BY ImdbId
            ORDER BY LastPublishedAt DESC
            LIMIT @limit
            """,
            new { limit }
        ).AsList();
    }

    // Every release sharing the IMDb id (directly or through its media entity) gets the same ratings.
    private const string SiblingReleasesWhere = """
        WHERE id = @id
           OR ext_imdb_id = @sourceImdbId
           OR (@entityId IS NOT NULL AND @entityId > 0 AND entity_id = @entityId)
           OR entity_id IN (SELECT me.id FROM media_entities me
                            WHERE me.ext_imdb_id = @sourceImdbId OR me.imdb_id = @sourceImdbId)
        """;

    private void ApplyRatings(long releaseId, long? entityId, string sourceImdbId, OmdbClient.RatingsResult r, long ts)
    {
        using var conn = _db.Open();
        using var tx   = conn.BeginTransaction();

        const string relSql = """
            UPDATE releases SET
                ext_imdb_id      = COALESCE(ext_imdb_id, @imdbId),
                ext_imdb_score   = @imdbScore,
                ext_imdb_votes   = @imdbVotes,
                ext_rt_score     = @rtScore,
                ext_metascore    = @metascore,
                ext_ratings_fetched_at = @ts
            """ + SiblingReleasesWhere;

        conn.Execute(relSql, new
        {
            id         = releaseId,
            entityId,
            sourceImdbId,
            imdbId     = r.ImdbId,
            imdbScore  = r.ImdbScore,
            imdbVotes  = r.ImdbVotes,
            rtScore    = r.RottenTomatoes,
            metascore  = r.Metascore,
            ts
        }, tx);

        if (entityId.HasValue && entityId.Value > 0)
        {
            const string entSql = """
                UPDATE media_entities SET
                    ext_imdb_id    = COALESCE(ext_imdb_id, @imdbId),
                    ext_imdb_score = @imdbScore,
                    ext_imdb_votes = @imdbVotes,
                    ext_rt_score   = @rtScore,
                    ext_metascore  = @metascore,
                    updated_at_ts  = @ts
                WHERE id = @entityId
                """;
            conn.Execute(entSql, new
            {
                entityId   = entityId.Value,
                imdbId     = r.ImdbId,
                imdbScore  = r.ImdbScore,
                imdbVotes  = r.ImdbVotes,
                rtScore    = r.RottenTomatoes,
                metascore  = r.Metascore,
                ts
            }, tx);
        }

        tx.Commit();
    }

    private void MarkFetched(long releaseId, long? entityId, string sourceImdbId, long ts)
    {
        using var conn = _db.Open();
        conn.Execute(
            "UPDATE releases SET ext_ratings_fetched_at = @ts " + SiblingReleasesWhere,
            new { id = releaseId, entityId, sourceImdbId, ts });
    }
}
