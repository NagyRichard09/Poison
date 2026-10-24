import React, { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../../api/client.js";
import SeerrSettingsPanel from "./SeerrSettingsPanel.jsx";

const TYPE_LABELS = {
  MEDIA_PENDING: "Függőben",
  MEDIA_APPROVED: "Jóváhagyva",
  MEDIA_AUTO_APPROVED: "Automatikusan jóváhagyva",
  MEDIA_AVAILABLE: "Elérhető",
  MEDIA_DECLINED: "Elutasítva",
  MEDIA_FAILED: "Sikertelen",
  MEDIA_AUTO_REQUESTED: "Watchlist kérés",
};

// Plain hex colors: an alpha suffix is appended (color + "22"), which would be
// invalid CSS with a var(...) value.
const TYPE_COLORS = {
  MEDIA_PENDING: "#8A6D1F",
  MEDIA_APPROVED: "#0F6E56",
  MEDIA_AUTO_APPROVED: "#0F6E56",
  MEDIA_AVAILABLE: "#3B6D11",
  MEDIA_DECLINED: "#A32D2D",
  MEDIA_FAILED: "#A32D2D",
  MEDIA_AUTO_REQUESTED: "#8A6D1F",
};
const FALLBACK_TYPE_COLOR = "#6B7280";

const PUSH_LABELS = {
  approved: { text: "Elküldve – elfogadva", color: "#0F6E56" },
  rejected: { text: "Elküldve – elutasítva", color: "#8A6D1F" },
  error: { text: "Küldési hiba", color: "#A32D2D" },
};

const btn = {
  fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--bg3, var(--bg2))", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap",
};

function fmtTs(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("hu-HU");
}

function fmtSize(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

function Badge({ text, color }) {
  return (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 600,
      padding: "2px 8px", borderRadius: 4,
      background: color + "22", color, border: `1px solid ${color}55`,
    }}>
      {text}
    </span>
  );
}

function TypeBadge({ type }) {
  return <Badge text={TYPE_LABELS[type] || type || "—"} color={TYPE_COLORS[type] || FALLBACK_TYPE_COLOR} />;
}

function MediaTypeBadge({ type }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 3,
      background: type === "tv" ? "var(--accent-purple-subtle, #EEEDFE)"
                                : "var(--accent-blue-subtle, #E6F1FB)",
      color: type === "tv" ? "var(--accent-purple, #534AB7)"
                           : "var(--accent-blue, #185FA5)",
    }}>
      {type === "tv" ? "Sorozat" : "Film"}
    </span>
  );
}

function StatTile({ label, value, color }) {
  return (
    <div style={{
      flex: "1 1 110px", background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "0.6rem 0.9rem",
    }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color || "var(--text)" }}>{value ?? 0}</div>
    </div>
  );
}

function RequestCard({ req, busy, onAction }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const push = req.arrPushStatus ? PUSH_LABELS[req.arrPushStatus] : null;
  const isBusy = (action) => busy === `${action}:${req.id}`;

  return (
    <div style={{
      background: "var(--bg2)", border: "1px solid " +
        (req.matched ? "var(--teal100, #9FE1CB)" : "var(--border)"),
      borderRadius: 10, padding: "0.75rem 1rem",
      display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "4px 14px", alignItems: "start",
    }}>
      {/* Poster */}
      <div style={{ width: 46, height: 69, borderRadius: 6, overflow: "hidden", background: "var(--bg3, var(--bg))" }}>
        {req.posterUrl ? (
          <img src={req.posterUrl} alt="" loading="lazy" referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 20 }}>
            {req.mediaType === "tv" ? "📺" : "🎬"}
          </div>
        )}
      </div>

      {/* Title + meta */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            {req.title}{req.year ? ` (${req.year})` : ""}
          </span>
          <MediaTypeBadge type={req.mediaType} />
          <TypeBadge type={req.type} />
          {req.matched && (
            <span style={{ fontSize: 11, color: "var(--teal600, #0F6E56)", fontWeight: 500 }}>
              ✓ Egyeztetett
            </span>
          )}
          {push && <Badge text={push.text} color={push.color} />}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
          {req.requestedSeasons ? <span>Évad: {req.requestedSeasons.split(",").join(", ")}</span> : null}
          {req.tmdbId ? <span>TMDB: {req.tmdbId}</span> : null}
          {req.tvdbId ? <span>TVDB: {req.tvdbId}</span> : null}
          {req.requestedBy && <span>Kérte: {req.requestedBy}</span>}
          <span>Beérkezett: {fmtTs(req.receivedAtTs)}</span>
          {req.matched && req.matchedAtTs ? <span>Egyeztetés: {fmtTs(req.matchedAtTs)}</span> : null}
        </div>
        {req.matched && req.matchedReleaseId && (
          <div
            style={{ fontSize: 12, marginTop: 5, color: "var(--text2)", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={req.matchedReleaseTitle || ""}
          >
            📦 {req.matchedReleaseTitle || `Release #${req.matchedReleaseId}`}
            <span style={{ color: "var(--muted)", marginLeft: 8 }}>
              {req.matchedReleaseHun ? "🇭🇺 " : ""}
              {req.matchedReleaseSeeders != null ? `${req.matchedReleaseSeeders} seeder` : ""}
              {req.matchedReleaseSize ? ` · ${fmtSize(req.matchedReleaseSize)}` : ""}
            </span>
          </div>
        )}
        {req.arrPushMessage && (
          <div style={{ fontSize: 11, marginTop: 3, color: push?.color || "var(--muted)" }}>
            {req.arrPushMessage}{req.arrPushedAtTs ? ` · ${fmtTs(req.arrPushedAtTs)}` : ""}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
        {req.tmdbId ? (
          <a
            href={`https://www.themoviedb.org/${req.mediaType === "tv" ? "tv" : "movie"}/${req.tmdbId}`}
            target="_blank" rel="noreferrer"
            style={{ fontSize: 11, color: "var(--accent-blue, #185FA5)", textDecoration: "none" }}
          >
            TMDB ↗
          </a>
        ) : null}
        {req.matched && (
          <button type="button" style={btn} disabled={!!busy}
            onClick={() => onAction("push", req)}
            title={req.mediaType === "tv" ? "Küldés Sonarr-ba (release push)" : "Küldés Radarr-ba (release push)"}>
            {isBusy("push") ? "Küldés…" : `➜ ${req.mediaType === "tv" ? "Sonarr" : "Radarr"}`}
          </button>
        )}
        <button type="button" style={btn} disabled={!!busy} onClick={() => onAction("rematch", req)}
          title={req.matched ? "Egyezés törlése és új keresés" : "Keresés most"}>
          {isBusy("rematch") ? "Keresés…" : req.matched ? "↻ Újraegyeztetés" : "🔍 Keresés"}
        </button>
        {confirmDelete ? (
          <span style={{ display: "flex", gap: 4 }}>
            <button type="button" style={{ ...btn, background: "#A32D2D", color: "#fff", border: "none" }}
              disabled={!!busy} onClick={() => { setConfirmDelete(false); onAction("delete", req); }}>
              Biztos?
            </button>
            <button type="button" style={btn} onClick={() => setConfirmDelete(false)}>Mégse</button>
          </span>
        ) : (
          <button type="button" style={btn} disabled={!!busy} onClick={() => setConfirmDelete(true)}>
            🗑 Törlés
          </button>
        )}
      </div>
    </div>
  );
}

export default function SeerrRequestsPage() {
  const [items, setItems]   = useState([]);
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "unmatched" | "matched"
  const [matching, setMatching] = useState(false);
  const [busy, setBusy] = useState("");
  const [info, setInfo] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [data, st] = await Promise.all([
        apiGet(`/api/seerr/requests?filter=${encodeURIComponent(filter)}`),
        apiGet("/api/seerr/stats").catch(() => null),
      ]);
      setItems(Array.isArray(data) ? data : []);
      setStats(st);
    } catch (e) {
      setErr(e?.message || "Betöltési hiba");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const runMatch = async () => {
    setMatching(true);
    setErr("");
    setInfo("");
    try {
      const r = await apiPost("/api/seerr/match");
      const count = Number(r?.matched || 0);
      setInfo(count > 0 ? `${count} új egyezés.` : "Nincs új egyezés.");
      if (count > 0) await load();
    } catch (e) {
      setErr(e?.message || "Egyeztetési hiba");
    } finally {
      setMatching(false);
    }
  };

  const onAction = async (action, req) => {
    setBusy(`${action}:${req.id}`);
    setErr("");
    setInfo("");
    try {
      if (action === "push") {
        const r = await apiPost(`/api/seerr/requests/${req.id}/push`);
        setInfo(`${req.title}: ${r?.message || (r?.ok ? "elküldve" : "hiba")}`);
      } else if (action === "rematch") {
        const r = await apiPost(`/api/seerr/requests/${req.id}/rematch`);
        setInfo(r?.matched
          ? `${req.title}: találat – ${r?.match?.title || ""}${r?.match?.pushSummary ? ` (${r.match.pushSummary})` : ""}`
          : `${req.title}: nincs megfelelő release.`);
      } else if (action === "delete") {
        await apiDelete(`/api/seerr/requests/${req.id}`);
        setInfo(`${req.title} törölve.`);
      }
      await load();
    } catch (e) {
      setErr(e?.message || "Művelet sikertelen");
    } finally {
      setBusy("");
    }
  };

  const displayed = items; // filtered server-side

  return (
    <div style={{ padding: "1.5rem", maxWidth: 960, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
          Seerr kérések
        </h1>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Overseerr / Jellyseerr webhook
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={runMatch}
            disabled={matching}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6,
              background: "var(--accent-teal, #0F6E56)", color: "#fff", border: "none",
              cursor: matching ? "not-allowed" : "pointer", opacity: matching ? 0.6 : 1 }}
          >
            {matching ? "Egyeztetés…" : "🔗 Egyeztetés futtatása"}
          </button>
          <button
            onClick={load}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6,
              border: "1px solid var(--border)", background: "var(--bg2)", cursor: "pointer" }}
          >
            ↻ Frissítés
          </button>
          <button
            onClick={() => setShowSettings((v) => !v)}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
              border: "1px solid " + (showSettings ? "var(--accent-blue, #185FA5)" : "var(--border)"),
              background: showSettings ? "var(--accent-blue-subtle, #E6F1FB)" : "var(--bg2)" }}
          >
            ⚙️ Beállítások
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
          <StatTile label="Összes kérés" value={stats.total} />
          <StatTile label="Várakozik" value={stats.pending} color="#8A6D1F" />
          <StatTile label="Egyeztetett" value={stats.matched} color="#0F6E56" />
          <StatTile label="Arr-ba küldve" value={stats.pushed} color="#534AB7" />
          <StatTile label="Elutasított" value={stats.declined} color="#A32D2D" />
        </div>
      )}

      {showSettings && <SeerrSettingsPanel />}

      {/* Webhook setup info */}
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "1rem 1.25rem", marginBottom: "1.25rem",
        fontSize: 13, color: "var(--text2)"
      }}>
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 6 }}>
          🔌 Webhook beállítás Seerr-ben
        </strong>
        Seerr → Beállítások → Értesítések → Webhook<br />
        <code style={{
          display: "inline-block", marginTop: 6, padding: "3px 8px",
          background: "var(--bg3)", borderRadius: 4, fontSize: 12, userSelect: "all"
        }}>
          POST {window.location.origin}/api/seerr/webhook
        </code>
        <span style={{ marginLeft: 12, color: "var(--muted)", fontSize: 12 }}>
          JSON Payload Type: Default · Events: Requested, Auto-Approved, Approved, Available, Declined
        </span>
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
          Ha a Feedarr hitelesítést használ, add meg a Seerr webhook „Authorization Header” mezőjében
          (pl. <code>Basic &lt;base64(felhasználó:jelszó)&gt;</code>). A kért évadokat és a posztert a
          webhook alapértelmezett sablonjából olvassa ki. Tipp: a Beállítások → Alkalmazás-központ →
          „Összekötés indítása” ezt a webhookot automatikusan beállítja a Seerr-ben.
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
        {[["all","Összes"], ["unmatched","Nem egyeztetett"], ["matched","Egyeztetett"]].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            fontSize: 13, padding: "4px 12px", borderRadius: 16,
            border: "1px solid " + (filter === v ? "var(--accent-blue, #185FA5)" : "var(--border)"),
            background: filter === v ? "var(--accent-blue-subtle, #E6F1FB)" : "var(--bg2)",
            color: filter === v ? "var(--accent-blue, #185FA5)" : "var(--text2)",
            cursor: "pointer",
          }}>
            {l}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
          {displayed.length} kérés
        </span>
      </div>

      {err && (
        <div style={{ background: "var(--red-subtle, #FCEBEB)", border: "1px solid var(--red, #A32D2D)",
          borderRadius: 8, padding: "0.75rem 1rem", color: "var(--red, #A32D2D)",
          marginBottom: "1rem", fontSize: 13 }}>
          {err}
        </div>
      )}

      {info && !err && (
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "0.6rem 1rem", color: "var(--text2)",
          marginBottom: "1rem", fontSize: 13 }}>
          {info}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          Betöltés…
        </div>
      )}

      {!loading && displayed.length === 0 && (
        <div style={{
          textAlign: "center", padding: "3rem", color: "var(--muted)",
          background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)"
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 14 }}>
            {filter === "unmatched"
              ? "Minden kérés egyeztetett."
              : filter === "matched"
                ? "Még nincs egyeztetett kérés."
                : "Még nem érkezett Seerr webhook."}
          </div>
          {filter === "all" && (
            <div style={{ fontSize: 12, marginTop: 6, color: "var(--muted)" }}>
              Állítsd be a fenti webhook URL-t a Seerr-ben.
            </div>
          )}
        </div>
      )}

      {!loading && displayed.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {displayed.map((req) => (
            <RequestCard key={req.id} req={req} busy={busy} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}
