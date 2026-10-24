import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPut } from "../../api/client.js";
import { useSubbarSetter } from "../../layout/useSubbar.js";
import SubAction from "../../ui/SubAction.jsx";
import Loader from "../../ui/Loader.jsx";
import ToggleSwitch from "../../ui/ToggleSwitch.jsx";
import DiskSpaceBars from "../../ui/disk/DiskSpaceBars.jsx";
import { NO_RUNTIME_TRANSLATE, useL } from "../../app/i18n.js";

const MAX_PATHS = 10;

function ToggleRow({ title, help, checked, onChange }) {
  return (
    <div className="indexer-card">
      <div className="indexer-row indexer-row--settings">
        <span className="indexer-title">{title}</span>
        <div className="indexer-actions">
          <ToggleSwitch checked={!!checked} onChange={(e) => onChange(!!e?.target?.checked)} title={title} />
        </div>
      </div>
      {help && <div className="settings-help">{help}</div>}
    </div>
  );
}

function NumberRow({ title, help, value, min, max, suffix, onChange }) {
  return (
    <div className="indexer-card">
      <div className="indexer-row indexer-row--settings">
        <span className="indexer-title">{title}</span>
        <div className="indexer-actions" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: 90 }}
          />
          <span className="muted">{suffix}</span>
        </div>
      </div>
      {help && <div className="settings-help">{help}</div>}
    </div>
  );
}

export default function SettingsStoragePage() {
  const L = useL();
  const setContent = useSubbarSetter();
  const [settings, setSettings] = useState(null);
  const [disk, setDisk] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setErr("");
    try {
      const [s, d] = await Promise.all([
        apiGet("/api/system/disk-space/settings"),
        apiGet(`/api/system/disk-space${refresh ? "?refresh=true" : ""}`),
      ]);
      setSettings({ ...(s || {}), extraPaths: Array.isArray(s?.extraPaths) ? s.extraPaths : [] });
      setDisk(d || null);
      setDirty(false);
    } catch (e) {
      setErr(e?.message || "load error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setDirty(true);
    setSaveState("idle");
  };

  const save = useCallback(async () => {
    if (!settings) return;
    setSaveState("loading");
    setErr("");
    try {
      const body = {
        ...settings,
        warnFreePercent: Math.max(0, Math.min(90, Number(settings.warnFreePercent) || 0)),
        warnFreeGb: Math.max(0, Number(settings.warnFreeGb) || 0),
        extraPaths: (settings.extraPaths || []).map((p) => String(p || "").trim()).filter(Boolean),
      };
      const saved = await apiPut("/api/system/disk-space/settings", body);
      setSettings({ ...(saved || body), extraPaths: saved?.extraPaths || body.extraPaths });
      setDisk(await apiGet("/api/system/disk-space?refresh=true"));
      setDirty(false);
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 1800);
    } catch (e) {
      setErr(e?.message || "save error");
      setSaveState("error");
    }
  }, [settings]);

  // Stable refs for the subbar
  const saveRef = useRef(save);
  const loadRef = useRef(load);
  saveRef.current = save;
  loadRef.current = load;

  useEffect(() => {
    setContent(
      <div className="settings-subbar-content" {...NO_RUNTIME_TRANSLATE}>
        <SubAction icon="refresh" label={L("Frissítés", "Refresh", "Actualiser")} onClick={() => loadRef.current?.(true)} />
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

  const paths = settings?.extraPaths || [];
  const setPath = (i, value) => update({ extraPaths: paths.map((p, idx) => (idx === i ? value : p)) });
  const removePath = (i) => update({ extraPaths: paths.filter((_, idx) => idx !== i) });
  const addPath = () => update({ extraPaths: [...paths, ""] });

  return (
    <div className="page page--settings" {...NO_RUNTIME_TRANSLATE}>
      <div className="pagehead">
        <div>
          <h1>{L("Tárhely", "Storage", "Stockage")}</h1>
          <div className="muted">{L("Szabad hely a meghajtókon, figyelmeztetés és főképernyő widget", "Free space on your drives, warnings and main screen widget", "Espace libre des disques, alertes et widget de l'écran principal")}</div>
        </div>
      </div>
      <div className="pagehead__divider" />

      {loading && <Loader label={L("Betöltés…", "Loading…", "Chargement…")} />}

      {!loading && err && (
        <div className="errorbox">
          <div className="errorbox__title">{L("Hiba", "Error", "Erreur")}</div>
          <div className="muted">{err}</div>
        </div>
      )}

      {!loading && settings && (
        <div className="settings-grid">
          <div className="settings-card settings-card--full" id="disk-volumes">
            <div className="settings-card__title">
              {L("Meghajtók", "Drives", "Disques")}
              {disk?.anyLow && <span style={{ color: "#ef4444", marginLeft: 8, fontSize: 13 }}>⚠️ {L("kevés a szabad hely", "low free space", "espace libre faible")}</span>}
            </div>
            <DiskSpaceBars volumes={disk?.volumes} />
            {(disk?.missingPaths || []).length > 0 && (
              <div className="settings-help" style={{ color: "#ef4444", marginTop: 10 }}>
                {L("Nem található / nem elérhető", "Not found / unavailable", "Introuvable / indisponible")}: {disk.missingPaths.join(", ")}
                {" "}— {L("Docker esetén a mappát volume-ként csatolni kell a konténerbe.", "With Docker the folder must be mounted into the container as a volume.", "Avec Docker, le dossier doit être monté comme volume dans le conteneur.")}
              </div>
            )}
            {disk?.checkedAtTs ? (
              <div className="settings-help" style={{ marginTop: 8 }}>
                {L("Utolsó ellenőrzés", "Last check", "Dernière vérification")}: {new Date(disk.checkedAtTs * 1000).toLocaleString(L("hu-HU", "en-US", "fr-FR"))}
              </div>
            ) : null}
          </div>

          <div className="settings-card" id="disk-display">
            <div className="settings-card__title">{L("Megjelenítés", "Display", "Affichage")}</div>
            <div className="indexer-list">
              <ToggleRow
                title={L("Megjelenítés a főképernyőn", "Show on the main screen", "Afficher sur l'écran principal")}
                help={L("A Könyvtár oldal tetején egy kis sáv mutatja a szabad helyet. A sáv × gombjával is elrejthető.", "A small bar at the top of the Library page shows the free space. Its × button hides it too.", "Une petite barre en haut de la Bibliothèque affiche l'espace libre. Son bouton × la masque aussi.")}
                checked={settings.showOnMainScreen}
                onChange={(v) => update({ showOnMainScreen: v })}
              />
              <ToggleRow
                title={L("Szokásos csatolási pontok", "Common mount points", "Points de montage habituels")}
                help={L("A /, /data, /downloads, /media, /tv, /movies stb. mappák automatikus figyelése, ha léteznek.", "Automatically watch /, /data, /downloads, /media, /tv, /movies etc. when they exist.", "Surveille automatiquement /, /data, /downloads, /media, /tv, /movies, etc. s'ils existent.")}
                checked={settings.includeDefaultPaths}
                onChange={(v) => update({ includeDefaultPaths: v })}
              />
            </div>
          </div>

          <div className="settings-card" id="disk-warning">
            <div className="settings-card__title">{L("Figyelmeztetés", "Warning", "Alerte")}</div>
            <div className="indexer-list">
              <NumberRow
                title={L("Kevés hely, ha a szabad terület kevesebb mint", "Low space when free space is below", "Espace faible si l'espace libre est inférieur à")}
                help={L("0 = kikapcsolva.", "0 = off.", "0 = désactivé.")}
                value={settings.warnFreePercent ?? 10}
                min={0}
                max={90}
                suffix="%"
                onChange={(v) => update({ warnFreePercent: v })}
              />
              <NumberRow
                title={L("…vagy kevesebb mint", "…or below", "…ou inférieur à")}
                help={L("Abszolút határ GB-ban, nagy lemezekhez hasznos. 0 = kikapcsolva.", "Absolute limit in GB, useful for large disks. 0 = off.", "Seuil absolu en Go, utile pour les gros disques. 0 = désactivé.")}
                value={settings.warnFreeGb ?? 0}
                min={0}
                max={100000}
                suffix="GB"
                onChange={(v) => update({ warnFreeGb: v })}
              />
              <ToggleRow
                title={L("Értesítés küldése", "Send a notification", "Envoyer une notification")}
                help={L("Discord / ntfy / webhook üzenet, amikor egy meghajtó a határ alá kerül (15 percenként ellenőrizve). A csatornák a Seerr oldal Beállítások paneljén adhatók meg.", "Discord / ntfy / webhook message when a drive drops below the limit (checked every 15 minutes). Channels are set in the Settings panel of the Seerr page.", "Message Discord / ntfy / webhook quand un disque passe sous le seuil (vérifié toutes les 15 minutes). Les canaux se règlent dans le panneau Paramètres de la page Seerr.")}
                checked={settings.notifyOnLow}
                onChange={(v) => update({ notifyOnLow: v })}
              />
            </div>
          </div>

          <div className="settings-card settings-card--full" id="disk-paths">
            <div className="settings-card__title">{L("Figyelt mappák", "Watched folders", "Dossiers surveillés")}</div>
            <div className="settings-help" style={{ marginBottom: 8 }}>
              {L("Pl. a letöltési vagy média mappa (Dockerben a konténeren belüli útvonal, pl.", "E.g. the download or media folder (with Docker the path inside the container, e.g.", "Par ex. le dossier de téléchargement ou de médias (avec Docker, le chemin dans le conteneur, ex.")} <code>/downloads</code>).
              {" "}{L("Az azonos lemezen lévő mappák egy sorban jelennek meg. A Poisonarr adatmappája mindig figyelve van.", "Folders on the same disk are shown in one row. Poisonarr's data folder is always watched.", "Les dossiers d'un même disque apparaissent sur une ligne. Le dossier de données de Poisonarr est toujours surveillé.")}
            </div>
            <div className="diskspace-paths">
              {paths.map((p, i) => (
                <div className="diskspace-paths__row" key={i}>
                  <input
                    type="text"
                    value={p}
                    placeholder="/downloads"
                    onChange={(e) => setPath(i, e.target.value)}
                    aria-label={`${L("Figyelt mappa", "Watched folder", "Dossier surveillé")} ${i + 1}`}
                  />
                  <button type="button" className="btn" onClick={() => removePath(i)} title={L("Eltávolítás", "Remove", "Retirer")}>
                    {L("Törlés", "Delete", "Supprimer")}
                  </button>
                </div>
              ))}
              {paths.length < MAX_PATHS && (
                <div>
                  <button type="button" className="btn" onClick={addPath}>+ {L("Mappa hozzáadása", "Add folder", "Ajouter un dossier")}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
