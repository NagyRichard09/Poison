/** Helpers for the sidebar "Alkalmazások" hub. Pure functions (unit tested). */

export const APP_TYPES = [
  { type: "seerr", name: "Seerr", icon: "popcorn", port: 5055 },
  { type: "prowlarr", name: "Prowlarr", icon: "radar", port: 9696 },
  { type: "sonarr", name: "Sonarr", icon: "tv", port: 8989 },
  { type: "radarr", name: "Radarr", icon: "film", port: 7878 },
  { type: "tautulli", name: "Tautulli", icon: "activity", port: 8181 },
  { type: "qbittorrent", name: "qBittorrent", icon: "download", port: 8090 },
  { type: "custom", name: "Egyéni", icon: "open_in_new", port: null },
];

export function appIcon(type) {
  return APP_TYPES.find((t) => t.type === type)?.icon || "open_in_new";
}

/**
 * Replaces "{host}" with the host name Feedarr is opened on, so "http://{host}:8989"
 * works from the phone as well as from the PC.
 */
export function resolveAppUrl(url, hostname) {
  const host = hostname || (typeof window !== "undefined" ? window.location.hostname : "localhost");
  const safeHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host; // IPv6
  return String(url || "").split("{host}").join(safeHost);
}

/** Only http(s) URLs may be opened or embedded. */
export function isSafeAppUrl(url) {
  try {
    const u = new URL(resolveAppUrl(url, "placeholder.local"));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Browsers block http:// frames inside an https:// page (mixed content). */
export function isMixedContent(url, pageProtocol) {
  const proto = pageProtocol || (typeof window !== "undefined" ? window.location.protocol : "http:");
  return proto === "https:" && String(url || "").trim().toLowerCase().startsWith("http://");
}

/** Slug for a new link id. */
export function slugifyAppId(name, existingIds = []) {
  const base = String(name || "app")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "app";
  let id = base;
  let i = 2;
  const taken = new Set(existingIds);
  while (taken.has(id)) {
    id = `${base}-${i}`;
    i += 1;
  }
  return id;
}
