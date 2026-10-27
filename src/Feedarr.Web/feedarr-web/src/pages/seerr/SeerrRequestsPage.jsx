import React, { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../../api/client.js";
import SeerrSettingsPanel from "./SeerrSettingsPanel.jsx";
import { NO_RUNTIME_TRANSLATE, pick, useL } from "../../app/i18n.js";

// [hu, en, fr]
const TYPE_LABELS = {
  MEDIA_PENDING: ["Függőben", "Pending", "En attente"],
  MEDIA_APPROVED: ["Jóváhagyva", "Approved", "Approuvée"],
  MEDIA_AUTO_APPROVED: ["Automatikusan jóváhagyva", "Auto-approved", "Approuvée automatiquement"],
  MEDIA_AVAILABLE: ["Elérhető", "Available", "Disponible"],
  MEDIA_DECLINED: ["Elutasítva", "Declined", "Refusée"],
  MEDIA_FAILED: ["Sikertelen", "Failed", "Échec"],
  MEDIA_AUTO_REQUESTED: ["Watchlist kérés", "Watchlist request", "Demande watchlist"],
};

// Plain hex colors: an alpha suffix is appended (color + "22"), which would be
// invalid CSS with a var(...) value.
const TYPE_COLORS = {
  MEDIA_PENDING: "#e0a42e",
  MEDIA_APPROVED: "#2bd96b",
  MEDIA_AUTO_APPROVED: "#2bd96b",
  MEDIA_AVAILABLE: "#6cf04a",
  MEDIA_DECLINED: "#e5484d",
  MEDIA_FAILED: "#e5484d",
  MEDIA_AUTO_REQUESTED: "#e0a42e",
};
const FALLBACK_TYPE_COLOR = "#8f80ad";

const PUSH_LABELS = {
  approved: { text: ["Elküldve – elfogadva", "Sent – accepted", "Envoyée – acceptée"], color: "#2bd96b" },
  rejected: { text: ["Elküldve – elutasítva", "Sent – rejected", "Envoyée – rejetée"], color: "#e0a42e" },
  error: { text: ["Küldési hiba", "Send error", "Erreur d'envoi"], color: "#e5484d" },
};

const btn = {
  fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid var(--panel-border)",
  background: "var(--panel-soft)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap",
};

function fmtTs(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(pick("hu-HU", "en-US", "fr-FR"));
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
  const label = TYPE_LABELS[type];
  return <Badge text={label ? pick(...label) : type || "—"} color={TYPE_COLORS[type] || FALLBACK_TYPE_COLOR} />;
}

function MediaTypeBadge({ type }) {
  const L = useL();
  return (
    <span style={{
      fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 3,
      background: type === "tv" ? "color-mix(in srgb, var(--cork) 18%, transparent)"
                                : "color-mix(in srgb, var(--accent-2) 16%, transparent)",
      color: type === "tv" ? "var(--accent-2)"
                           : "var(--accent-2)",
    }}>
      {type === "tv" ? L("Sorozat", "Series", "Série") : L("Film", "Movie", "Film")}
    </span>
  );
}

function StatTile({ label, value, color }) {
  return (
    <div style={{
      flex: "1 1 110px", background: "var(--panel)", border: "1px solid var(--panel-border)",
      borderRadius: 10, padding: "0.6rem 0.9rem",
    }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color || "var(--text)" }}>{value ?? 0}</div>
    </div>
  );
}

function RequestCard({ req, busy, onAction }) {
  const L = useL();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const push = req.arrPushStatus ? PUSH_LABELS[req.arrPushStatus] : null;
  const isBusy = (action) => busy === `${action}:${req.id}`;

  return (
    <div style={{
      background: "var(--panel)", border: "1px solid " +
        (req.matched ? "color-mix(in srgb, var(--toxin-strong) 55%, transparent)" : "var(--panel-border)"),
      borderRadius: 10, padding: "0.75rem 1rem",
      display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "4px 14px", alignItems: "start",
    }}>
      {/* Poster */}
      <div style={{ width: 46, height: 69, borderRadius: 6, overflow: "hidden", background: "var(--input-bg)" }}>
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
            <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 500 }}>
              ✓ {L("Egyeztetett", "Matched", "Associée")}
            </span>
          )}
          {push && <Badge text={pick(...push.text)} color={push.color} />}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
          {req.requestedSeasons ? <span>{L("Évad", "Season", "Saison")}: {req.requestedSeasons.split(",").join(", ")}</span> : null}
          {req.tmdbId ? <span>TMDB: {req.tmdbId}</span> : null}
          {req.tvdbId ? <span>TVDB: {req.tvdbId}</span> : null}
          {req.requestedBy && <span>{L("Kérte", "Requested by", "Demandé par")}: {req.requestedBy}</span>}
          <span>{L("Beérkezett", "Received", "Reçue")}: {fmtTs(req.receivedAtTs)}</span>
          {req.matched && req.matchedAtTs ? <span>{L("Egyeztetés", "Matched", "Association")}: {fmtTs(req.matchedAtTs)}</span> : null}
        </div>
        {req.matched && req.matchedReleaseId && (
          <div
            style={{ fontSize: 12, marginTop: 5, color: "var(--muted)", overflow: "hidden",
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
            style={{ fontSize: 11, color: "var(--accent-2)", textDecoration: "none" }}
          >
            TMDB ↗
          </a>
        ) : null}
        {req.matched && (
          <button type="button" style={btn} disabled={!!busy}
            onClick={() => onAction("push", req)}
            title={`${L("Küldés:", "Send to", "Envoyer vers")} ${req.mediaType === "tv" ? "Sonarr" : "Radarr"} (release push)`}>
            {isBusy("push") ? L("Küldés…", "Sending…", "Envoi…") : `➜ ${req.mediaType === "tv" ? "Sonarr" : "Radarr"}`}
          </button>
        )}
        <button type="button" style={btn} disabled={!!busy} onClick={() => onAction("rematch", req)}
          title={req.matched ? L("Egyezés törlése és új keresés", "Clear match and search again", "Effacer l'association et rechercher") : L("Keresés most", "Search now", "Rechercher maintenant")}>
          {isBusy("rematch") ? L("Keresés…", "Searching…", "Recherche…") : req.matched ? `↻ ${L("Újraegyeztetés", "Re-match", "Réassocier")}` : `🔍 ${L("Keresés", "Search", "Rechercher")}`}
        </button>
        {confirmDelete ? (
          <span style={{ display: "flex", gap: 4 }}>
            <button type="button" style={{ ...btn, background: "#e5484d", color: "#fff", border: "none" }}
              disabled={!!busy} onClick={() => { setConfirmDelete(false); onAction("delete", req); }}>
              {L("Biztos?", "Sure?", "Sûr ?")}
            </button>
            <button type="button" style={btn} onClick={() => setConfirmDelete(false)}>{L("Mégse", "Cancel", "Annuler")}</button>
          </span>
        ) : (
          <button type="button" style={btn} disabled={!!busy} onClick={() => setConfirmDelete(true)}>
            🗑 {L("Törlés", "Delete", "Supprimer")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function SeerrRequestsPage() {
  const L = useL();
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
      setErr(e?.message || L("Betöltési hiba", "Load error", "Erreur de chargement"));
    } finally {
      setLoading(false);
    }
  }, [filter, L]);

  useEffect(() => { load(); }, [load]);

  const runMatch = async () => {
    setMatching(true);
    setErr("");
    setInfo("");
    try {
      const r = await apiPost("/api/seerr/match");
      const count = Number(r?.matched || 0);
      setInfo(count > 0 ? L(`${count} új egyezés.`, `${count} new match(es).`, `${count} nouvelle(s) association(s).`) : L("Nincs új egyezés.", "No new match.", "Aucune nouvelle association."));
      if (count > 0) await load();
    } catch (e) {
      setErr(e?.message || L("Egyeztetési hiba", "Matching error", "Erreur d'association"));
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
        setInfo(`${req.title}: ${r?.message || (r?.ok ? L("elküldve", "sent", "envoyée") : L("hiba", "error", "erreur"))}`);
      } else if (action === "rematch") {
        const r = await apiPost(`/api/seerr/requests/${req.id}/rematch`);
        setInfo(r?.matched
          ? `${req.title}: ${L("találat", "match", "trouvé")} – ${r?.match?.title || ""}${r?.match?.pushSummary ? ` (${r.match.pushSummary})` : ""}`
          : `${req.title}: ${L("nincs megfelelő release.", "no suitable release.", "aucune release adaptée.")}`);
      } else if (action === "delete") {
        await apiDelete(`/api/seerr/requests/${req.id}`);
        setInfo(`${req.title} ${L("törölve.", "deleted.", "supprimée.")}`);
      }
      await load();
    } catch (e) {
      setErr(e?.message || L("Művelet sikertelen", "Action failed", "Échec de l'action"));
    } finally {
      setBusy("");
    }
  };

  const displayed = items; // filtered server-side

  return (
    <div style={{ padding: "1.5rem", maxWidth: 960, margin: "0 auto" }} {...NO_RUNTIME_TRANSLATE}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
          {L("Seerr kérések", "Seerr requests", "Demandes Seerr")}
        </h1>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Overseerr / Jellyseerr webhook
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={runMatch}
            disabled={matching}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6,
              background: "var(--accent-fill)", color: "var(--on-accent)", border: "none",
              cursor: matching ? "not-allowed" : "pointer", opacity: matching ? 0.6 : 1 }}
          >
            {matching ? L("Egyeztetés…", "Matching…", "Association…") : `🔗 ${L("Egyeztetés futtatása", "Run matching", "Lancer l'association")}`}
          </button>
          <button
            onClick={load}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6,
              border: "1px solid var(--panel-border)", background: "var(--panel)", cursor: "pointer" }}
          >
            ↻ {L("Frissítés", "Refresh", "Actualiser")}
          </button>
          <button
            onClick={() => setShowSettings((v) => !v)}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
              border: "1px solid " + (showSettings ? "var(--accent-2)" : "var(--panel-border)"),
              background: showSettings ? "color-mix(in srgb, var(--accent-2) 16%, transparent)" : "var(--panel)" }}
          >
            ⚙️ {L("Beállítások", "Settings", "Paramètres")}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
          <StatTile label={L("Összes kérés", "All requests", "Toutes les demandes")} value={stats.total} />
          <StatTile label={L("Várakozik", "Waiting", "En attente")} value={stats.pending} color="#e0a42e" />
          <StatTile label={L("Egyeztetett", "Matched", "Associées")} value={stats.matched} color="#2bd96b" />
          <StatTile label={L("Arr-ba küldve", "Sent to Arr", "Envoyées vers Arr")} value={stats.pushed} color="#a77bff" />
          <StatTile label={L("Elutasított", "Declined", "Refusées")} value={stats.declined} color="#e5484d" />
        </div>
      )}

      {showSettings && <SeerrSettingsPanel />}

      {/* Webhook setup info */}
      <div style={{
        background: "var(--panel)", border: "1px solid var(--panel-border)",
        borderRadius: 10, padding: "1rem 1.25rem", marginBottom: "1.25rem",
        fontSize: 13, color: "var(--muted)"
      }}>
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 6 }}>
          🔌 {L("Webhook beállítás Seerr-ben", "Webhook setup in Seerr", "Configuration du webhook dans Seerr")}
        </strong>
        {L("Seerr → Beállítások → Értesítések → Webhook", "Seerr → Settings → Notifications → Webhook", "Seerr → Paramètres → Notifications → Webhook")}<br />
        <code style={{
          display: "inline-block", marginTop: 6, padding: "3px 8px",
          background: "var(--panel-soft)", borderRadius: 4, fontSize: 12, userSelect: "all"
        }}>
          POST {window.location.origin}/api/seerr/webhook
        </code>
        <span style={{ marginLeft: 12, color: "var(--muted)", fontSize: 12 }}>
          JSON Payload Type: Default · Events: Requested, Auto-Approved, Approved, Available, Declined
        </span>
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
          {L("Ha a Poisonarr hitelesítést használ, add meg a Seerr webhook „Authorization Header” mezőjében (pl.", "If Poisonarr uses authentication, set it in the Seerr webhook “Authorization Header” field (e.g.", "Si Poisonarr utilise une authentification, renseignez-la dans le champ « Authorization Header » du webhook Seerr (ex.")}{" "}
          <code>Basic &lt;base64({L("felhasználó:jelszó", "user:password", "utilisateur:mot_de_passe")})&gt;</code>). {L("A kért évadokat és a posztert a webhook alapértelmezett sablonjából olvassa ki. Tipp: a Beállítások → Alkalmazás-központ → „Összekötés indítása” ezt a webhookot automatikusan beállítja a Seerr-ben.", "Requested seasons and the poster are read from the webhook's default template. Tip: Settings → App hub → “Start connecting” sets this webhook up in Seerr automatically.", "Les saisons demandées et l'affiche sont lues depuis le modèle par défaut du webhook. Astuce : Paramètres → Centre d'applications → « Lancer la connexion » configure ce webhook automatiquement dans Seerr.")}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
        {[["all", L("Összes", "All", "Toutes")], ["unmatched", L("Nem egyeztetett", "Unmatched", "Non associées")], ["matched", L("Egyeztetett", "Matched", "Associées")]].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            fontSize: 13, padding: "4px 12px", borderRadius: 16,
            border: "1px solid " + (filter === v ? "var(--accent-2)" : "var(--panel-border)"),
            background: filter === v ? "color-mix(in srgb, var(--accent-2) 16%, transparent)" : "var(--panel)",
            color: filter === v ? "var(--accent-2)" : "var(--muted)",
            cursor: "pointer",
          }}>
            {l}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
          {displayed.length} {L("kérés", "requests", "demandes")}
        </span>
      </div>

      {err && (
        <div style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", border: "1px solid var(--danger)",
          borderRadius: 8, padding: "0.75rem 1rem", color: "var(--danger)",
          marginBottom: "1rem", fontSize: 13 }}>
          {err}
        </div>
      )}

      {info && !err && (
        <div style={{ background: "var(--panel)", border: "1px solid var(--panel-border)",
          borderRadius: 8, padding: "0.6rem 1rem", color: "var(--muted)",
          marginBottom: "1rem", fontSize: 13 }}>
          {info}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          {L("Betöltés…", "Loading…", "Chargement…")}
        </div>
      )}

      {!loading && displayed.length === 0 && (
        <div style={{
          textAlign: "center", padding: "3rem", color: "var(--muted)",
          background: "var(--panel)", borderRadius: 10, border: "1px solid var(--panel-border)"
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 14 }}>
            {filter === "unmatched"
              ? L("Minden kérés egyeztetett.", "Every request is matched.", "Toutes les demandes sont associées.")
              : filter === "matched"
                ? L("Még nincs egyeztetett kérés.", "No matched request yet.", "Aucune demande associée pour l'instant.")
                : L("Még nem érkezett Seerr webhook.", "No Seerr webhook received yet.", "Aucun webhook Seerr reçu pour l'instant.")}
          </div>
          {filter === "all" && (
            <div style={{ fontSize: 12, marginTop: 6, color: "var(--muted)" }}>
              {L("Állítsd be a fenti webhook URL-t a Seerr-ben.", "Set the webhook URL above in Seerr.", "Configurez l'URL du webhook ci-dessus dans Seerr.")}
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
