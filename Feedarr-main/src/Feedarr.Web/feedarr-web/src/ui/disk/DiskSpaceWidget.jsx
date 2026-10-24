import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPut } from "../../api/client.js";
import DiskSpaceBars from "./DiskSpaceBars.jsx";

const REFRESH_MS = 5 * 60 * 1000;

/**
 * Main screen widget: shown only when "Megjelenítés a főképernyőn" is enabled
 * (Settings → Tárhely). The × button turns the option off again.
 */
export default function DiskSpaceWidget() {
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
    <div className={`diskspace-widget${data.anyLow ? " is-low" : ""}`}>
      <div className="diskspace-widget__head">
        <Link to="/settings/storage" className="diskspace-widget__title" title="Tárhely beállítások">
          💾 Szabad terület
        </Link>
        <button
          type="button"
          className="diskspace-widget__close"
          onClick={hide}
          title="Elrejtés a főképernyőről (visszakapcsolható: Beállítások → Tárhely)"
          aria-label="Elrejtés"
        >
          ×
        </button>
      </div>
      <DiskSpaceBars volumes={data.volumes} compact />
    </div>
  );
}
