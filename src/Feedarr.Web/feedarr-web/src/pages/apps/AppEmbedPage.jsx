import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSubbarSetter } from "../../layout/useSubbar.js";
import SubAction from "../../ui/SubAction.jsx";
import AppIcon from "../../ui/AppIcon.jsx";
import Loader from "../../ui/Loader.jsx";
import useAppLinks from "../../apps/useAppLinks.js";
import { appIcon, isMixedContent, isSafeAppUrl, resolveAppUrl } from "../../apps/appLinks.js";

/** Shows one of the user's apps (Sonarr, Radarr, ...) inside Feedarr. */
export default function AppEmbedPage() {
  const { id } = useParams();
  const setContent = useSubbarSetter();
  const { links, statusById, loaded } = useAppLinks();
  const [frameKey, setFrameKey] = useState(0);

  const link = useMemo(() => links.find((l) => l.id === id), [links, id]);
  const url = link && isSafeAppUrl(link.url) ? resolveAppUrl(link.url) : null;
  const status = link ? statusById[link.id] : null;
  const mixed = url ? isMixedContent(url) : false;
  const blocked = status?.embeddable === false;

  useEffect(() => {
    setContent(
      <div className="settings-subbar-content">
        <div className="appembed__title">
          {link && <AppIcon name={appIcon(link.type)} />}
          <span>{link?.name || "Alkalmazás"}</span>
          {status && (
            <span className={`appembed__status ${status.online ? "is-online" : "is-offline"}`}>
              {status.online ? "elérhető" : "nem elérhető"}
            </span>
          )}
        </div>
        <div className="subspacer" />
        <SubAction icon="refresh" label="Újratöltés" onClick={() => setFrameKey((k) => k + 1)} disabled={!url} />
        <SubAction
          icon="open_in_new"
          label="Új lapon"
          onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
          disabled={!url}
        />
      </div>
    );
    return () => setContent(null);
  }, [setContent, link, url, status]);

  if (!loaded) return <Loader label="Betöltés…" />;

  if (!link || !url) {
    return (
      <div className="page">
        <div className="errorbox">
          <div className="errorbox__title">Ismeretlen alkalmazás</div>
          <div className="muted">
            Ez az alkalmazás nincs beállítva. <Link to="/settings/hub">Alkalmazások kezelése</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="appembed">
      {(blocked || mixed) && (
        <div className="appembed__notice">
          {mixed
            ? "A Feedarr HTTPS-en fut, az alkalmazás HTTP-n: a böngésző nem engedi beágyazni. "
            : `A(z) ${link.name} nem engedi a beágyazást (X-Frame-Options / frame-ancestors). `}
          <a href={url} target="_blank" rel="noopener noreferrer">Megnyitás új lapon</a>
          {" "}vagy állítsd „új lap” módra az <Link to="/settings/hub">Alkalmazások</Link> között.
          {link.type === "qbittorrent" && !mixed && (
            <> qBittorrentnél: Beállítások → Web UI → „Clickjacking védelem” kikapcsolása.</>
          )}
        </div>
      )}
      <iframe
        key={frameKey}
        className="appembed__frame"
        src={url}
        title={link.name}
        referrerPolicy="no-referrer"
        allow="fullscreen; clipboard-read; clipboard-write"
      />
    </div>
  );
}
