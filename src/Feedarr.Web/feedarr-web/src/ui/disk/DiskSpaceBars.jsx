import React from "react";
import { diskTone, fmtDiskBytes, usedPercent } from "./diskFormat.js";

/**
 * List of volumes with a usage bar. `compact` renders the slim main-screen variant.
 */
export default function DiskSpaceBars({ volumes, compact = false }) {
  const list = Array.isArray(volumes) ? volumes : [];
  if (list.length === 0) {
    return <div className="muted">Nincs megjeleníthető meghajtó.</div>;
  }

  return (
    <div className={`diskspace-list${compact ? " diskspace-list--compact" : ""}`}>
      {list.map((v) => {
        const pct = usedPercent(v);
        const tone = diskTone(v);
        const barClass =
          "storage-bar" +
          (tone === "critical" ? " storage-bar--critical" : tone === "warn" ? " storage-bar--warn" : "");
        const extraPaths = (v.paths || []).filter((p) => p !== v.path && p !== "/");
        return (
          <div key={v.mountPoint || v.path} className={`diskspace-item${v.isLow ? " is-low" : ""}`}>
            <div className="diskspace-item__head">
              <span className="diskspace-item__label" title={(v.paths || []).join("\n")}>
                {v.isLow ? "⚠️ " : ""}{v.label}
                {!compact && v.path !== v.label && <span className="muted"> · {v.path}</span>}
              </span>
              <span className="diskspace-item__free">
                <strong>{fmtDiskBytes(v.freeBytes)}</strong> szabad
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
                aria-label={`${v.label}: ${pct}% foglalt`}
              >
                <div className="storage-bar__fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="storage-usage">{Math.round(pct)}%</span>
            </div>
            {!compact && (
              <div className="diskspace-item__meta muted">
                Csatolási pont: {v.mountPoint}
                {extraPaths.length > 0 && <> · ugyanezen a lemezen: {extraPaths.join(", ")}</>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
