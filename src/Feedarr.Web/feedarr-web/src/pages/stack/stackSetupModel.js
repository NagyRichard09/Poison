/** Pure helpers of the stack setup wizard (unit tested). */

export const STACK_STEPS = [
  { id: "start", type: null },
  { id: "plex", type: "plex" },
  { id: "radarr", type: "radarr" },
  { id: "sonarr", type: "sonarr" },
  { id: "prowlarr", type: "prowlarr" },
  { id: "seerr", type: "seerr" },
  { id: "qbittorrent", type: "qbittorrent" },
  { id: "tautulli", type: "tautulli" },
  { id: "feedarr", type: null },
];

/**
 * Poisonarr password policy (the strictest of the stack, see SettingsController):
 * at least 12 characters with upper case, lower case, digit and symbol.
 * Returns a list of unmet rule ids.
 */
export function passwordProblems(password) {
  const p = String(password || "");
  const problems = [];
  if (p.length < 12) problems.push("length");
  if (!/[a-z]/.test(p)) problems.push("lower");
  if (!/[A-Z]/.test(p)) problems.push("upper");
  if (!/[0-9]/.test(p)) problems.push("digit");
  if (!/[^A-Za-z0-9]/.test(p)) problems.push("symbol");
  return problems;
}

/** Usernames accepted by every app of the stack. */
export function isValidUsername(username) {
  return /^[A-Za-z0-9._-]{3,32}$/.test(String(username || "").trim());
}

/** Browser URL of a stack app on the same host as Poisonarr. */
export function appUrl(port, hostname) {
  const host = hostname || (typeof window !== "undefined" ? window.location.hostname : "localhost");
  const safeHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  // The apps of the stack listen on plain http on their own port.
  return `http://${safeHost}:${port}`;
}

export function statusOf(status, type) {
  return (status?.apps || []).find((a) => a.type === type) || null;
}
