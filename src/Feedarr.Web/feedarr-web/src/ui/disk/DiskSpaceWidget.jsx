import React, { useCallback, useEffect, useState } from "react";
import { NO_RUNTIME_TRANSLATE, useL } from "../../app/i18n.js";
import { Link } from "react-router-dom";
import { apiGet, apiPut } from "../../api/client.js";
import DiskSpaceBars from "./DiskSpaceBars.jsx";

const REFRESH_MS = 5 * 60 * 1000;

/**
 * Main screen widget: shown only when "Megjelenítés a főképernyőn" is enabled
 * (Settings → Tárhely). The × button turns the option off again.
 */
export default function DiskSpaceWidget() {
  const L = useL();
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiGet("/api/system/disk-space");
      setData(d || null);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const hide = async () => {
    setHidden(true);
    try {
      const current = await apiGet("/api/system/disk-space/settings");
      await apiPut("/api/system/disk-space/settings", { ...(current || {}), showOnMainScreen: false });
    } catch {
      setHidden(false);
    }
  };

  if (hidden || !data?.showOnMainScreen || !(data.volumes || []).length) return null;

  return (
    <div className={`diskspace-widget${data.anyLow ? " is-low" : ""}`} {...NO_RUNTIME_TRANSLATE}>
      <div className="diskspace-widget__head">
        <Link to="/settings/storage" className="diskspace-widget__title" title={L("Tárhely beállítások", "Storage settings", "Paramètres de stockage")}>
          💾 {L("Szabad terület", "Free space", "Espace libre")}
        </Link>
        <button
          type="button"
          className="diskspace-widget__close"
          onClick={hide}
          title={L("Elrejtés a főképernyőről (visszakapcsolható: Beállítások → Tárhely)", "Hide from the main screen (re-enable: Settings → Storage)", "Masquer de l'écran principal (réactivable : Paramètres → Stockage)")}
          aria-label={L("Elrejtés", "Hide", "Masquer")}
        >
          ×
        </button>
      </div>
      <DiskSpaceBars volumes={data.volumes} compact />
    </div>
  );
}
