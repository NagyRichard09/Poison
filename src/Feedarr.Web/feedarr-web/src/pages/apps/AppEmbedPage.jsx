import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSubbarSetter } from "../../layout/useSubbar.js";
import SubAction from "../../ui/SubAction.jsx";
import AppIcon from "../../ui/AppIcon.jsx";
import Loader from "../../ui/Loader.jsx";
import useAppLinks from "../../apps/useAppLinks.js";
import { appIcon, isMixedContent, isSafeAppUrl, resolveAppUrl } from "../../apps/appLinks.js";
import { NO_RUNTIME_TRANSLATE, useL } from "../../app/i18n.js";

/** Shows one of the user's apps (Sonarr, Radarr, ...) inside Poisonarr. */
export default function AppEmbedPage() {
  const L = useL();
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
      <div className="settings-subbar-content" {...NO_RUNTIME_TRANSLATE}>
        <div className="appembed__title">
          {link && <AppIcon name={appIcon(link.type)} />}
          <span>{link?.name || L("Alkalmazás", "App", "Application")}</span>
          {status && (
            <span className={`appembed__status ${status.online ? "is-online" : "is-offline"}`}>
              {status.online ? L("elérhető", "online", "en ligne") : L("nem elérhető", "offline", "hors ligne")}
            </span>
          )}
        </div>
        <div className="subspacer" />
        <SubAction icon="refresh" label={L("Újratöltés", "Reload", "Recharger")} onClick={() => setFrameKey((k) => k + 1)} disabled={!url} />
        <SubAction
          icon="open_in_new"
          label={L("Új lapon", "New tab", "Nouvel onglet")}
          onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
          disabled={!url}
        />
      </div>
    );
    return () => setContent(null);
  }, [setContent, link, url, status, L]);

  if (!loaded) return <Loader label={L("Betöltés…", "Loading…", "Chargement…")} />;

  if (!link || !url) {
    return (
      <div className="page" {...NO_RUNTIME_TRANSLATE}>
        <div className="errorbox">
          <div className="errorbox__title">{L("Ismeretlen alkalmazás", "Unknown app", "Application inconnue")}</div>
          <div className="muted">
            {L("Ez az alkalmazás nincs beállítva.", "This app is not configured.", "Cette application n'est pas configurée.")}{" "}
            <Link to="/settings/hub">{L("Alkalmazások kezelése", "Manage apps", "Gérer les applications")}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="appembed" {...NO_RUNTIME_TRANSLATE}>
      {(blocked || mixed) && (
        <div className="appembed__notice">
          {mixed
            ? L("A Poisonarr HTTPS-en fut, az alkalmazás HTTP-n: a böngésző nem engedi beágyazni. ",
                "Poisonarr runs on HTTPS and the app on HTTP: the browser refuses to embed it. ",
                "Poisonarr est en HTTPS et l'application en HTTP : le navigateur refuse de l'intégrer. ")
            : L(`A(z) ${link.name} nem engedi a beágyazást (X-Frame-Options / frame-ancestors). `,
                `${link.name} does not allow embedding (X-Frame-Options / frame-ancestors). `,
                `${link.name} n'autorise pas l'intégration (X-Frame-Options / frame-ancestors). `)}
          <a href={url} target="_blank" rel="noopener noreferrer">{L("Megnyitás új lapon", "Open in a new tab", "Ouvrir dans un nouvel onglet")}</a>
          {" "}{L("vagy állítsd „új lap” módra itt:", "or switch it to “new tab” mode in", "ou passez-la en mode « nouvel onglet » dans")}{" "}
          <Link to="/settings/hub">{L("Alkalmazások", "Apps", "Applications")}</Link>.
          {link.type === "qbittorrent" && !mixed && (
            <> {L("qBittorrentnél: Beállítások → Web UI → „Clickjacking védelem” kikapcsolása.",
                "In qBittorrent: Options → Web UI → turn off “clickjacking protection”.",
                "Dans qBittorrent : Options → Web UI → désactiver la « protection clickjacking ».")}</>
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
