import React from "react";
import { NO_RUNTIME_TRANSLATE, useL } from "../../app/i18n.js";
import { diskTone, fmtDiskBytes, usedPercent } from "./diskFormat.js";

/**
 * List of volumes with a usage bar. `compact` renders the slim main-screen variant.
 */
export default function DiskSpaceBars({ volumes, compact = false }) {
  const L = useL();
  const list = Array.isArray(volumes) ? volumes : [];
  if (list.length === 0) {
    return <div className="muted" {...NO_RUNTIME_TRANSLATE}>{L("Nincs megjeleníthető meghajtó.", "No drive to show.", "Aucun disque à afficher.")}</div>;
  }

  return (
    <div className={`diskspace-list${compact ? " diskspace-list--compact" : ""}`} {...NO_RUNTIME_TRANSLATE}>
      {list.map((v) => {
        const pct = usedPercent(v);
        const tone = diskTone(v);
        const barClass =
          "storage-bar" +
          (tone === "critical" ? " storage-bar--critical" : tone === "warn" ? " storage-bar--warn" : "");
        const extraPaths = (v.paths || []).filter((p) => p !== v.path && p !== "/");
        // The backend names the data volume "Poisonarr adatok"; show it in the UI language.
        const label = v.isDataDir && (v.label === "Poisonarr adatok" || v.label === "Feedarr adatok") ? L("Poisonarr adatok", "Poisonarr data", "Données Poisonarr") : v.label;
        return (
          <div key={v.mountPoint || v.path} className={`diskspace-item${v.isLow ? " is-low" : ""}`}>
            <div className="diskspace-item__head">
              <span className="diskspace-item__label" title={(v.paths || []).join("\n")}>
                {v.isLow ? "⚠️ " : ""}{label}
                {!compact && v.path !== v.label && v.path !== label && <span className="muted"> · {v.path}</span>}
              </span>
              <span className="diskspace-item__free">
                <strong>{fmtDiskBytes(v.freeBytes)}</strong> {L("szabad", "free", "libre")}
                <span className="muted"> / {fmtDiskBytes(v.totalBytes)}</span>
              </span>
            </div>
            <div className="diskspace-item__bar">
              <div
                className={barClass}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={`${label}: ${pct}% ${L("foglalt", "used", "utilisé")}`}
              >
                <div className="storage-bar__fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="storage-usage">{Math.round(pct)}%</span>
            </div>
            {!compact && (
              <div className="diskspace-item__meta muted">
                {L("Csatolási pont", "Mount point", "Point de montage")}: {v.mountPoint}
                {extraPaths.length > 0 && <> · {L("ugyanezen a lemezen", "on the same disk", "sur le même disque")}: {extraPaths.join(", ")}</>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
