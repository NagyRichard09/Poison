import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../api/client.js";
import { useSubbarSetter } from "../../layout/useSubbar.js";
import SubAction from "../../ui/SubAction.jsx";
import Loader from "../../ui/Loader.jsx";
import AppIcon from "../../ui/AppIcon.jsx";
import ToggleSwitch from "../../ui/ToggleSwitch.jsx";
import { APP_TYPES, appIcon, isSafeAppUrl, slugifyAppId } from "../../apps/appLinks.js";
import { notifyAppsChanged } from "../../apps/useAppLinks.js";

const inputStyle = { width: "100%", boxSizing: "border-box" };

function LinkEditor({ link, index, count, status, onChange, onMove, onRemove }) {
  const urlOk = isSafeAppUrl(link.url);
  return (
    <div className="indexer-card apphub-link">
      <div className="apphub-link__row">
        <AppIcon name={appIcon(link.type)} className="apphub-link__icon" />
        <input
          type="text"
          value={link.name}
          onChange={(e) => onChange({ ...link, name: e.target.value })}
          aria-label="Név"
          className="apphub-link__name"
        />
        <select value={link.type} onChange={(e) => onChange({ ...link, type: e.target.value })} aria-label="Típus">
          {APP_TYPES.map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}
        </select>
        <select value={link.openMode} onChange={(e) => onChange({ ...link, openMode: e.target.value })} aria-label="Megnyitás">
          <option value="embed">Feedarr-on belül</option>
          <option value="tab">Új lapon</option>
        </select>
        <ToggleSwitch checked={link.enabled !== false} onChange={(e) => onChange({ ...link, enabled: !!e?.target?.checked })}
          title="Megjelenik az oldalsávban" />
        <span className="apphub-link__actions">
          <button type="button" className="btn" disabled={index === 0} onClick={() => onMove(-1)} title="Fel">↑</button>
          <button type="button" className="btn" disabled={index === count - 1} onClick={() => onMove(1)} title="Le">↓</button>
          <button type="button" className="btn" onClick={onRemove} title="Törlés">✕</button>
        </span>
      </div>
      <div className="apphub-link__urls">
        <label>
          <span className="muted">Böngésző URL</span>
          <input type="text" style={inputStyle} value={link.url} placeholder="http://{host}:8989"
            onChange={(e) => onChange({ ...link, url: e.target.value })}
            className={urlOk ? "" : "is-invalid"} />
        </label>
        <label>
          <span className="muted">Belső URL (állapotfigyeléshez, opcionális)</span>
          <input type="text" style={inputStyle} value={link.internalUrl || ""} placeholder="http://127.0.0.1:8989"
            onChange={(e) => onChange({ ...link, internalUrl: e.target.value })} />
        </label>
      </div>
      {status && (
        <div className="settings-help">
          {status.online ? `✓ elérhető (${status.elapsedMs} ms)` : `✕ nem elérhető${status.error ? `: ${status.error}` : ""}`}
          {status.embeddable === false && link.openMode === "embed" &&
            " · ⚠️ ez az alkalmazás tiltja a beágyazást, válaszd az „Új lapon” módot."}
        </div>
      )}
    </div>
  );
}

export default function SettingsAppHubPage() {
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
      setErr(e?.message || "Betöltési hiba");
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
      setErr(e?.message || "Mentési hiba");
      setSaveState("error");
    }
  }, [links, loadStatus]);

  const saveRef = useRef(save);
  const loadRef = useRef(load);
  saveRef.current = save;
  loadRef.current = load;

  useEffect(() => {
    setContent(
      <div className="settings-subbar-content">
        <SubAction icon="refresh" label="Frissítés" onClick={() => loadRef.current?.()} />
        <SubAction
          icon={saveState === "loading" ? "progress_activity" : saveState === "success" ? "check_circle"
            : saveState === "error" ? "cancel" : "save"}
          label="Mentés"
          onClick={() => saveRef.current?.()}
          disabled={saveState === "loading" || !dirty}
          className={saveState === "loading" ? "is-loading" : saveState === "success" ? "is-success"
            : saveState === "error" ? "is-error" : ""}
        />
      </div>
    );
    return () => setContent(null);
  }, [setContent, saveState, dirty]);

  const addFromCatalog = (type) => {
    const def = (discover?.defaults || []).find((d) => d.type === type);
    const meta = APP_TYPES.find((t) => t.type === type);
    const ids = (links || []).map((l) => l.id);
    const link = def
      ? { ...def, id: slugifyAppId(def.id, ids) }
      : {
          id: slugifyAppId(meta?.name || "app", ids),
          name: meta?.name || "Alkalmazás",
          type: type || "custom",
          url: meta?.port ? `http://{host}:${meta.port}` : "http://{host}:",
          internalUrl: meta?.port ? `http://127.0.0.1:${meta.port}` : "",
          openMode: "embed",
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
      setErr(e?.message || "Az automatikus beállítás nem sikerült");
    } finally {
      setSetupBusy(false);
    }
  };

  const usedTypes = new Set((links || []).map((l) => l.type));
  const discovered = discover?.apps || [];

  return (
    <div className="page page--settings">
      <div className="pagehead">
        <div>
          <h1>Alkalmazás-központ</h1>
          <div className="muted">Seerr, Prowlarr, Sonarr, Radarr, Tautulli, qBittorrent egy helyen</div>
        </div>
      </div>
      <div className="pagehead__divider" />

      {err && (
        <div className="errorbox">
          <div className="errorbox__title">Hiba</div>
          <div className="muted">{err}</div>
        </div>
      )}

      {links === null ? <Loader label="Betöltés…" /> : (
        <div className="settings-grid">
          <div className="settings-card settings-card--full" id="apphub-auto">
            <div className="settings-card__title">
              <AppIcon name="auto_fix" /> Automatikus összekötés
            </div>
            <div className="settings-help" style={{ marginBottom: 10 }}>
              A Feedarr a(z) <code>{discover?.configRoot || "/var/lib"}</code> mappában keresi az alkalmazások
              beállításait, és kiolvassa az API kulcsokat. Ezután beköti: Prowlarr → Feedarr, Sonarr/Radarr → Feedarr,
              Prowlarr → Sonarr/Radarr, qBittorrent → Sonarr/Radarr, Seerr → Sonarr/Radarr és Seerr webhook → Feedarr.
              A meglévő beállításokat nem írja felül.
            </div>
            <div className="apphub-discover">
              {discovered.length === 0 && <span className="muted">Nem található alkalmazás konfiguráció.</span>}
              {discovered.map((a) => (
                <span key={a.type} className={`apphub-chip${a.hasApiKey || a.type === "qbittorrent" ? " is-ok" : ""}`}
                  title={a.configPath}>
                  <AppIcon name={appIcon(a.type)} /> {a.name} :{a.port}
                  {a.type !== "qbittorrent" && (a.hasApiKey ? " 🔑" : " (nincs kulcs)")}
                </span>
              ))}
            </div>
            <div className="apphub-setup-grid">
              <label>
                <span className="muted">qBittorrent felhasználó</span>
                <input type="text" value={setup.qbittorrentUsername} autoComplete="off"
                  onChange={(e) => setSetup({ ...setup, qbittorrentUsername: e.target.value })} />
              </label>
              <label>
                <span className="muted">qBittorrent jelszó</span>
                <input type="password" value={setup.qbittorrentPassword} autoComplete="new-password"
                  placeholder="a telepítő kiírta / ~/feedarr-stack-credentials.txt"
                  onChange={(e) => setSetup({ ...setup, qbittorrentPassword: e.target.value })} />
              </label>
              <label>
                <span className="muted">Sorozatok mappa (Sonarr)</span>
                <input type="text" value={setup.tvRootFolder}
                  onChange={(e) => setSetup({ ...setup, tvRootFolder: e.target.value })} />
              </label>
              <label>
                <span className="muted">Filmek mappa (Radarr)</span>
                <input type="text" value={setup.moviesRootFolder}
                  onChange={(e) => setSetup({ ...setup, moviesRootFolder: e.target.value })} />
              </label>
            </div>
            <div className="apphub-setup-toggles">
              <label><ToggleSwitch checked={setup.prowlarrSyncApps}
                onChange={(e) => setSetup({ ...setup, prowlarrSyncApps: !!e?.target?.checked })} /> Prowlarr → Sonarr/Radarr szinkron</label>
              <label><ToggleSwitch checked={setup.seerrArrServers}
                onChange={(e) => setSetup({ ...setup, seerrArrServers: !!e?.target?.checked })} /> Seerr → Sonarr/Radarr</label>
              <label><ToggleSwitch checked={setup.seerrWebhook}
                onChange={(e) => setSetup({ ...setup, seerrWebhook: !!e?.target?.checked })} /> Seerr webhook → Feedarr</label>
            </div>
            <button type="button" className="btn btn--primary" onClick={runAutoSetup} disabled={setupBusy || discovered.length === 0}>
              {setupBusy ? "Összekötés folyamatban…" : "Összekötés indítása"}
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
            <div className="settings-card__title">Oldalsáv menüpontok</div>
            <div className="settings-help" style={{ marginBottom: 10 }}>
              A <code>{"{host}"}</code> helyére a böngésző a Feedarr címét teszi, így a link telefonról is működik.
              „Feedarr-on belül” módban az alkalmazás a Feedarr felületén nyílik meg; ha az alkalmazás ezt tiltja,
              válaszd az „Új lapon” módot.
            </div>
            <div className="indexer-list">
              {links.length === 0 && <div className="muted">Még nincs alkalmazás. Add hozzá lent, vagy használd az automatikus összekötést.</div>}
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
              <span className="muted">Hozzáadás:</span>
              {APP_TYPES.map((t) => (
                <button key={t.type} type="button" className="btn" onClick={() => addFromCatalog(t.type)}
                  disabled={t.type !== "custom" && usedTypes.has(t.type)}>
                  <AppIcon name={t.icon} /> {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
