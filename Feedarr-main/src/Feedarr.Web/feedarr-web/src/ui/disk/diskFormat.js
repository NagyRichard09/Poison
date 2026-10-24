/** Byte formatter for the disk space UI (binary units, Hungarian decimal comma). */
export function fmtDiskBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i >= 3 ? 1 : 0;
  return `${v.toFixed(digits).replace(".", ",")} ${units[i]}`;
}

/** Used share in percent (0-100), rounded to one decimal. */
export function usedPercent(volume) {
  const total = Number(volume?.totalBytes || 0);
  if (total <= 0) return 0;
  const free = Math.max(0, Number(volume?.freeBytes || 0));
  return Math.round(Math.min(100, Math.max(0, ((total - free) / total) * 100)) * 10) / 10;
}

/** Bar tone: critical when flagged low by the server, warn above 85 % used. */
export function diskTone(volume) {
  if (volume?.isLow) return "critical";
  return usedPercent(volume) >= 85 ? "warn" : "ok";
}
