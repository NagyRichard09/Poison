import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPut } from "../../api/client.js";
import { useSubbarSetter } from "../../layout/useSubbar.js";
import SubAction from "../../ui/SubAction.jsx";
import Loader from "../../ui/Loader.jsx";
import ToggleSwitch from "../../ui/ToggleSwitch.jsx";
import DiskSpaceBars from "../../ui/disk/DiskSpaceBars.jsx";

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
      setErr(e?.message || "Betöltési hiba");
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
      setErr(e?.message || "Mentési hiba");
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
      <div className="settings-subbar-content">
        <SubAction icon="refresh" label="Frissítés" onClick={() => loadRef.current?.(true)} />
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

  const paths = settings?.extraPaths || [];
  const setPath = (i, value) => update({ extraPaths: paths.map((p, idx) => (idx === i ? value : p)) });
  const removePath = (i) => update({ extraPaths: paths.filter((_, idx) => idx !== i) });
  const addPath = () => update({ extraPaths: [...paths, ""] });

  return (
    <div className="page page--settings">
      <div className="pagehead">
        <div>
          <h1>Tárhely</h1>
          <div className="muted">Szabad hely a meghajtókon, figyelmeztetés és főképernyő widget</div>
        </div>
      </div>
      <div className="pagehead__divider" />

      {loading && <Loader label="Betöltés…" />}

      {!loading && err && (
        <div className="errorbox">
          <div className="errorbox__title">Hiba</div>
          <div className="muted">{err}</div>
        </div>
      )}

      {!loading && settings && (
        <div className="settings-grid">
          <div className="settings-card settings-card--full" id="disk-volumes">
            <div className="settings-card__title">
              Meghajtók
              {disk?.anyLow && <span style={{ color: "#ef4444", marginLeft: 8, fontSize: 13 }}>⚠️ kevés a szabad hely</span>}
            </div>
            <DiskSpaceBars volumes={disk?.volumes} />
            {(disk?.missingPaths || []).length > 0 && (
              <div className="settings-help" style={{ color: "#ef4444", marginTop: 10 }}>
                Nem található / nem elérhető: {disk.missingPaths.join(", ")}
                {" "}— Docker esetén a mappát volume-ként csatolni kell a konténerbe.
              </div>
            )}
            {disk?.checkedAtTs ? (
              <div className="settings-help" style={{ marginTop: 8 }}>
                Utolsó ellenőrzés: {new Date(disk.checkedAtTs * 1000).toLocaleString("hu-HU")}
              </div>
            ) : null}
          </div>

          <div className="settings-card" id="disk-display">
            <div className="settings-card__title">Megjelenítés</div>
            <div className="indexer-list">
              <ToggleRow
                title="Megjelenítés a főképernyőn"
                help="A Könyvtár oldal tetején egy kis sáv mutatja a szabad helyet. A sáv × gombjával is elrejthető."
                checked={settings.showOnMainScreen}
                onChange={(v) => update({ showOnMainScreen: v })}
              />
              <ToggleRow
                title="Szokásos csatolási pontok"
                help="A /, /data, /downloads, /media, /tv, /movies stb. mappák automatikus figyelése, ha léteznek."
                checked={settings.includeDefaultPaths}
                onChange={(v) => update({ includeDefaultPaths: v })}
              />
            </div>
          </div>

          <div className="settings-card" id="disk-warning">
            <div className="settings-card__title">Figyelmeztetés</div>
            <div className="indexer-list">
              <NumberRow
                title="Kevés hely, ha a szabad terület kevesebb mint"
                help="0 = kikapcsolva."
                value={settings.warnFreePercent ?? 10}
                min={0}
                max={90}
                suffix="%"
                onChange={(v) => update({ warnFreePercent: v })}
              />
              <NumberRow
                title="…vagy kevesebb mint"
                help="Abszolút határ GB-ban, nagy lemezekhez hasznos. 0 = kikapcsolva."
                value={settings.warnFreeGb ?? 0}
                min={0}
                max={100000}
                suffix="GB"
                onChange={(v) => update({ warnFreeGb: v })}
              />
              <ToggleRow
                title="Értesítés küldése"
                help="Discord / ntfy / webhook üzenet, amikor egy meghajtó a határ alá kerül (15 percenként ellenőrizve). A csatornák a Seerr oldal Beállítások paneljén adhatók meg."
                checked={settings.notifyOnLow}
                onChange={(v) => update({ notifyOnLow: v })}
              />
            </div>
          </div>

          <div className="settings-card settings-card--full" id="disk-paths">
            <div className="settings-card__title">Figyelt mappák</div>
            <div className="settings-help" style={{ marginBottom: 8 }}>
              Pl. a letöltési vagy média mappa (Dockerben a konténeren belüli útvonal, pl. <code>/downloads</code>).
              Az azonos lemezen lévő mappák egy sorban jelennek meg. A Feedarr adatmappája mindig figyelve van.
            </div>
            <div className="diskspace-paths">
              {paths.map((p, i) => (
                <div className="diskspace-paths__row" key={i}>
                  <input
                    type="text"
                    value={p}
                    placeholder="/downloads"
                    onChange={(e) => setPath(i, e.target.value)}
                    aria-label={`Figyelt mappa ${i + 1}`}
                  />
                  <button type="button" className="btn" onClick={() => removePath(i)} title="Eltávolítás">
                    Törlés
                  </button>
                </div>
              ))}
              {paths.length < MAX_PATHS && (
                <div>
                  <button type="button" className="btn" onClick={addPath}>+ Mappa hozzáadása</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
