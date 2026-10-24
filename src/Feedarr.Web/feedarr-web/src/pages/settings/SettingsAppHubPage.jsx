import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../api/client.js";
import { useSubbarSetter } from "../../layout/useSubbar.js";
import SubAction from "../../ui/SubAction.jsx";
import Loader from "../../ui/Loader.jsx";
import AppIcon from "../../ui/AppIcon.jsx";
import ToggleSwitch from "../../ui/ToggleSwitch.jsx";
import { APP_TYPES, appIcon, isSafeAppUrl, slugifyAppId } from "../../apps/appLinks.js";
import { notifyAppsChanged } from "../../apps/useAppLinks.js";
import { NO_RUNTIME_TRANSLATE, useL } from "../../app/i18n.js";

const inputStyle = { width: "100%", boxSizing: "border-box" };

function LinkEditor({ link, index, count, status, onChange, onMove, onRemove }) {
  const L = useL();
  const urlOk = isSafeAppUrl(link.url);
  return (
    <div className="indexer-card apphub-link">
      <div className="apphub-link__row">
        <AppIcon name={appIcon(link.type)} className="apphub-link__icon" />
        <input
          type="text"
          value={link.name}
          onChange={(e) => onChange({ ...link, name: e.target.value })}
          aria-label={L("Név", "Name", "Nom")}
          className="apphub-link__name"
        />
        <select value={link.type} onChange={(e) => onChange({ ...link, type: e.target.value })} aria-label={L("Típus", "Type", "Type")}>
          {APP_TYPES.map((t) => <option key={t.type} value={t.type}>{t.type === "custom" ? L("Egyéni", "Custom", "Personnalisé") : t.name}</option>)}
        </select>
        <select value={link.openMode} onChange={(e) => onChange({ ...link, openMode: e.target.value })} aria-label={L("Megnyitás", "Open mode", "Ouverture")}>
          <option value="embed">{L("Poisonarr-on belül", "Inside Poisonarr", "Dans Poisonarr")}</option>
          <option value="tab">{L("Új lapon", "New tab", "Nouvel onglet")}</option>
        </select>
        <ToggleSwitch checked={link.enabled !== false} onChange={(e) => onChange({ ...link, enabled: !!e?.target?.checked })}
          title={L("Megjelenik az oldalsávban", "Shown in the sidebar", "Affiché dans la barre latérale")} />
        <span className="apphub-link__actions">
          <button type="button" className="btn" disabled={index === 0} onClick={() => onMove(-1)} title={L("Fel", "Up", "Monter")}>↑</button>
          <button type="button" className="btn" disabled={index === count - 1} onClick={() => onMove(1)} title={L("Le", "Down", "Descendre")}>↓</button>
          <button type="button" className="btn" onClick={onRemove} title={L("Törlés", "Delete", "Supprimer")}>✕</button>
        </span>
      </div>
      <div className="apphub-link__urls">
        <label>
          <span className="muted">{L("Böngésző URL", "Browser URL", "URL du navigateur")}</span>
          <input type="text" style={inputStyle} value={link.url} placeholder="http://{host}:8989"
            onChange={(e) => onChange({ ...link, url: e.target.value })}
            className={urlOk ? "" : "is-invalid"} />
        </label>
        <label>
          <span className="muted">{L("Belső URL (állapotfigyeléshez, opcionális)", "Internal URL (for status checks, optional)", "URL interne (pour le statut, facultatif)")}</span>
          <input type="text" style={inputStyle} value={link.internalUrl || ""} placeholder="http://127.0.0.1:8989"
            onChange={(e) => onChange({ ...link, internalUrl: e.target.value })} />
        </label>
      </div>
      {status && (
        <div className="settings-help">
          {status.online
            ? `✓ ${L("elérhető", "online", "en ligne")} (${status.elapsedMs} ms)`
            : `✕ ${L("nem elérhető", "offline", "hors ligne")}${status.error ? `: ${status.error}` : ""}`}
          {status.embeddable === false && link.openMode === "embed" &&
            ` · ⚠️ ${L("ez az alkalmazás tiltja a beágyazást, válaszd az „Új lapon” módot.", "this app blocks embedding, choose “New tab” mode.", "cette application bloque l'intégration, choisissez le mode « Nouvel onglet ».")}`}
        </div>
      )}
    </div>
  );
}

export default function SettingsAppHubPage() {
  const L = useL();
  const setContent = useSubbarSetter();
  const [links, setLinks] = useState(null);
  const [status, setStatus] = useState({});
  const [discover, setDiscover] = useState(null);
  const [err, setErr] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [dirty, setDirty] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupResult, setSetupResult] = useState(null);
  const [setup, setSetup] = useState({
    qbittorrentUsername: "admin",
    qbittorrentPassword: "",
    tvRootFolder: "/srv/media/tv",
    moviesRootFolder: "/srv/media/movies",
    seerrWebhook: true,
    seerrArrServers: true,
    prowlarrSyncApps: true,
  });

  const loadStatus = useCallback(async () => {
    try {
      const s = await apiGet("/api/app-hub/status", { timeoutMs: 20000 });
      const map = {};
      (Array.isArray(s) ? s : []).forEach((x) => { map[x.id] = x; });
      setStatus(map);
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    setErr("");
    try {
      const [l, d] = await Promise.all([apiGet("/api/app-hub"), apiGet("/api/app-hub/discover").catch(() => null)]);
      setLinks(Array.isArray(l?.links) ? l.links : []);
      setDiscover(d);
      setDirty(false);
      loadStatus();
    } catch (e) {
      setErr(e?.message || "load error");
      setLinks([]);
    }
  }, [loadStatus]);

  useEffect(() => { load(); }, [load]);

  const change = (next) => {
    setLinks(next);
    setDirty(true);
    setSaveState("idle");
  };

  const save = useCallback(async () => {
    if (!links) return;
    setSaveState("loading");
    setErr("");
    try {
      const body = { links: links.map((l) => ({ ...l, internalUrl: l.internalUrl?.trim() || null })) };
      const saved = await apiPut("/api/app-hub", body);
      setLinks(saved?.links || body.links);
      setDirty(false);
      setSaveState("success");
      notifyAppsChanged();
      loadStatus();
      setTimeout(() => setSaveState("idle"), 1800);
    } catch (e) {
      setErr(e?.message || "save error");
      setSaveState("error");
    }
  }, [links, loadStatus]);

  const saveRef = useRef(save);
  const loadRef = useRef(load);
  saveRef.current = save;
  loadRef.current = load;

  useEffect(() => {
    setContent(
      <div className="settings-subbar-content" {...NO_RUNTIME_TRANSLATE}>
        <SubAction icon="refresh" label={L("Frissítés", "Refresh", "Actualiser")} onClick={() => loadRef.current?.()} />
        <SubAction
          icon={saveState === "loading" ? "progress_activity" : saveState === "success" ? "check_circle"
            : saveState === "error" ? "cancel" : "save"}
          label={L("Mentés", "Save", "Enregistrer")}
          onClick={() => saveRef.current?.()}
          disabled={saveState === "loading" || !dirty}
          className={saveState === "loading" ? "is-loading" : saveState === "success" ? "is-success"
            : saveState === "error" ? "is-error" : ""}
        />
      </div>
    );
    return () => setContent(null);
  }, [setContent, saveState, dirty, L]);

  const addFromCatalog = (type) => {
    const def = (discover?.defaults || []).find((d) => d.type === type);
    const meta = APP_TYPES.find((t) => t.type === type);
    const ids = (links || []).map((l) => l.id);
    const link = def
      ? { ...def, id: slugifyAppId(def.id, ids) }
      : {
          id: slugifyAppId(meta?.name || "app", ids),
          name: type === "custom" ? L("Alkalmazás", "App", "Application") : meta?.name || "App",
          type: type || "custom",
          url: meta?.port ? `http://{host}:${meta.port}${type === "plex" ? "/web" : ""}` : "http://{host}:",
          internalUrl: meta?.port ? `http://127.0.0.1:${meta.port}` : "",
          // Plex Web and qBittorrent refuse to be framed
          openMode: type === "plex" || type === "qbittorrent" ? "tab" : "embed",
          enabled: true,
        };
    change([...(links || []), link]);
  };

  const runAutoSetup = async () => {
    setSetupBusy(true);
    setSetupResult(null);
    setErr("");
    try {
      const r = await apiPost("/api/app-hub/auto-setup", {
        createLinks: true,
        registerArrApps: true,
        registerProwlarr: true,
        createRootFolders: true,
        ...setup,
      }, { timeoutMs: 120000 });
      setSetupResult(r);
      notifyAppsChanged();
      await load();
    } catch (e) {
      setErr(e?.message || L("Az automatikus beállítás nem sikerült", "Automatic setup failed", "La configuration automatique a échoué"));
    } finally {
      setSetupBusy(false);
    }
  };

  const usedTypes = new Set((links || []).map((l) => l.type));
  const discovered = discover?.apps || [];

  return (
    <div className="page page--settings" {...NO_RUNTIME_TRANSLATE}>
      <div className="pagehead">
        <div>
          <h1>{L("Alkalmazás-központ", "App hub", "Centre d'applications")}</h1>
          <div className="muted">{L("Seerr, Prowlarr, Sonarr, Radarr, Tautulli, qBittorrent egy helyen", "Seerr, Prowlarr, Sonarr, Radarr, Tautulli and qBittorrent in one place", "Seerr, Prowlarr, Sonarr, Radarr, Tautulli et qBittorrent au même endroit")}</div>
        </div>
      </div>
      <div className="pagehead__divider" />

      {err && (
        <div className="errorbox">
          <div className="errorbox__title">{L("Hiba", "Error", "Erreur")}</div>
          <div className="muted">{err}</div>
        </div>
      )}

      {links === null ? <Loader label={L("Betöltés…", "Loading…", "Chargement…")} /> : (
        <div className="settings-grid">
          <div className="settings-card settings-card--full" id="apphub-auto">
            <div className="settings-card__title">
              <AppIcon name="auto_fix" /> {L("Automatikus összekötés", "Automatic connection", "Connexion automatique")}
            </div>
            <div className="settings-help" style={{ marginBottom: 10 }}>
              {L("A Poisonarr ebben a mappában keresi az alkalmazások beállításait:", "Poisonarr looks for the apps' settings in", "Poisonarr cherche la configuration des applications dans")} <code>{discover?.configRoot || "/var/lib"}</code>{L(", és kiolvassa az API kulcsokat. Ezután beköti: Prowlarr → Poisonarr, Sonarr/Radarr → Poisonarr, Prowlarr → Sonarr/Radarr, qBittorrent → Sonarr/Radarr, Seerr → Sonarr/Radarr és Seerr webhook → Poisonarr. A meglévő beállításokat nem írja felül.", " and reads the API keys. Then it connects Prowlarr → Poisonarr, Sonarr/Radarr → Poisonarr, Prowlarr → Sonarr/Radarr, qBittorrent → Sonarr/Radarr, Seerr → Sonarr/Radarr and the Seerr webhook → Poisonarr. Existing settings are not overwritten.", " et lit les clés API. Puis il connecte Prowlarr → Poisonarr, Sonarr/Radarr → Poisonarr, Prowlarr → Sonarr/Radarr, qBittorrent → Sonarr/Radarr, Seerr → Sonarr/Radarr et le webhook Seerr → Poisonarr. Les réglages existants ne sont pas écrasés.")}
            </div>
            <div className="apphub-discover">
              {discovered.length === 0 && <span className="muted">{L("Nem található alkalmazás konfiguráció.", "No app configuration found.", "Aucune configuration d'application trouvée.")}</span>}
              {discovered.map((a) => (
                <span key={a.type} className={`apphub-chip${a.hasApiKey || a.type === "qbittorrent" ? " is-ok" : ""}`}
                  title={a.configPath}>
                  <AppIcon name={appIcon(a.type)} /> {a.name} :{a.port}
                  {a.type !== "qbittorrent" && (a.hasApiKey ? " 🔑" : ` (${L("nincs kulcs", "no key", "pas de clé")})`)}
                </span>
              ))}
            </div>
            <div className="apphub-setup-grid">
              <label>
                <span className="muted">{L("qBittorrent felhasználó", "qBittorrent username", "Utilisateur qBittorrent")}</span>
                <input type="text" value={setup.qbittorrentUsername} autoComplete="off"
                  onChange={(e) => setSetup({ ...setup, qbittorrentUsername: e.target.value })} />
              </label>
              <label>
                <span className="muted">{L("qBittorrent jelszó", "qBittorrent password", "Mot de passe qBittorrent")}</span>
                <input type="password" value={setup.qbittorrentPassword} autoComplete="new-password"
                  placeholder={L("a telepítő kiírta / ~/feedarr-stack-credentials.txt", "printed by the installer / ~/feedarr-stack-credentials.txt", "affiché par l'installateur / ~/feedarr-stack-credentials.txt")}
                  onChange={(e) => setSetup({ ...setup, qbittorrentPassword: e.target.value })} />
              </label>
              <label>
                <span className="muted">{L("Sorozatok mappa (Sonarr)", "Series folder (Sonarr)", "Dossier des séries (Sonarr)")}</span>
                <input type="text" value={setup.tvRootFolder}
                  onChange={(e) => setSetup({ ...setup, tvRootFolder: e.target.value })} />
              </label>
              <label>
                <span className="muted">{L("Filmek mappa (Radarr)", "Movies folder (Radarr)", "Dossier des films (Radarr)")}</span>
                <input type="text" value={setup.moviesRootFolder}
                  onChange={(e) => setSetup({ ...setup, moviesRootFolder: e.target.value })} />
              </label>
            </div>
            <div className="apphub-setup-toggles">
              <label><ToggleSwitch checked={setup.prowlarrSyncApps}
                onChange={(e) => setSetup({ ...setup, prowlarrSyncApps: !!e?.target?.checked })} /> Prowlarr → Sonarr/Radarr {L("szinkron", "sync", "synchro")}</label>
              <label><ToggleSwitch checked={setup.seerrArrServers}
                onChange={(e) => setSetup({ ...setup, seerrArrServers: !!e?.target?.checked })} /> Seerr → Sonarr/Radarr</label>
              <label><ToggleSwitch checked={setup.seerrWebhook}
                onChange={(e) => setSetup({ ...setup, seerrWebhook: !!e?.target?.checked })} /> Seerr webhook → Poisonarr</label>
            </div>
            <button type="button" className="btn btn--primary" onClick={runAutoSetup} disabled={setupBusy || discovered.length === 0}>
              {setupBusy ? L("Összekötés folyamatban…", "Connecting…", "Connexion en cours…") : L("Összekötés indítása", "Start connecting", "Lancer la connexion")}
            </button>
            {setupResult && (
              <ul className="apphub-steps">
                {(setupResult.steps || []).map((s, i) => (
                  <li key={i} className={s.ok ? "is-ok" : "is-error"}>
                    {s.ok ? "✓" : "✕"} {s.message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="settings-card settings-card--full" id="apphub-links">
            <div className="settings-card__title">{L("Oldalsáv menüpontok", "Sidebar entries", "Entrées de la barre latérale")}</div>
            <div className="settings-help" style={{ marginBottom: 10 }}>
              <code>{"{host}"}</code>{" "}{L("helyére a böngésző a Poisonarr címét teszi, így a link telefonról is működik. „Poisonarr-on belül” módban az alkalmazás a Poisonarr felületén nyílik meg; ha az alkalmazás ezt tiltja, válaszd az „Új lapon” módot.", "is replaced with the address Poisonarr is opened on, so the link works from a phone too. In “Inside Poisonarr” mode the app opens within Poisonarr; if the app blocks that, choose “New tab”.", "est remplacé par l'adresse de Poisonarr, le lien fonctionne donc aussi depuis un téléphone. En mode « Dans Poisonarr », l'application s'ouvre dans Poisonarr ; si elle le bloque, choisissez « Nouvel onglet ».")}
            </div>
            <div className="indexer-list">
              {links.length === 0 && <div className="muted">{L("Még nincs alkalmazás. Add hozzá lent, vagy használd az automatikus összekötést.", "No apps yet. Add one below or use the automatic connection.", "Aucune application. Ajoutez-en une ci-dessous ou utilisez la connexion automatique.")}</div>}
              {links.map((link, i) => (
                <LinkEditor
                  key={`${link.id}-${i}`}
                  link={link}
                  index={i}
                  count={links.length}
                  status={status[link.id]}
                  onChange={(next) => change(links.map((l, idx) => (idx === i ? next : l)))}
                  onMove={(delta) => {
                    const next = [...links];
                    const [item] = next.splice(i, 1);
                    next.splice(i + delta, 0, item);
                    change(next);
                  }}
                  onRemove={() => change(links.filter((_, idx) => idx !== i))}
                />
              ))}
            </div>
            <div className="apphub-add">
              <span className="muted">{L("Hozzáadás:", "Add:", "Ajouter :")}</span>
              {APP_TYPES.map((t) => (
                <button key={t.type} type="button" className="btn" onClick={() => addFromCatalog(t.type)}
                  disabled={t.type !== "custom" && usedTypes.has(t.type)}>
                  <AppIcon name={t.icon} /> {t.type === "custom" ? L("Egyéni", "Custom", "Personnalisé") : t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
