import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../api/client.js";

const STATUS_POLL_MS = 60 * 1000;
export const APPS_CHANGED_EVENT = "feedarr:apps-changed";

/** Notify every useAppLinks() consumer (sidebar, embed page) that the links were saved. */
export function notifyAppsChanged() {
  try {
    window.dispatchEvent(new Event(APPS_CHANGED_EVENT));
  } catch {
    /* non-browser */
  }
}

/**
 * Loads the configured app links and polls their status.
 * Returns { links, statusById, reload, loaded }.
 */
export default function useAppLinks({ withStatus = true } = {}) {
  const [links, setLinks] = useState([]);
  const [statusById, setStatusById] = useState({});
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await apiGet("/api/app-hub");
      setLinks(Array.isArray(data?.links) ? data.links : []);
    } catch {
      setLinks([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  const reloadStatus = useCallback(async () => {
    try {
      const data = await apiGet("/api/app-hub/status", { timeoutMs: 20000 });
      const map = {};
      (Array.isArray(data) ? data : []).forEach((s) => { map[s.id] = s; });
      setStatusById(map);
    } catch {
      /* keep previous status */
    }
  }, []);

  useEffect(() => {
    reload();
    const onChanged = () => {
      reload();
      if (withStatus) reloadStatus();
    };
    window.addEventListener(APPS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(APPS_CHANGED_EVENT, onChanged);
  }, [reload, reloadStatus, withStatus]);

  useEffect(() => {
    if (!withStatus || links.length === 0) return undefined;
    reloadStatus();
    const t = setInterval(reloadStatus, STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [withStatus, links.length, reloadStatus]);

  return { links, statusById, reload, reloadStatus, loaded };
}
