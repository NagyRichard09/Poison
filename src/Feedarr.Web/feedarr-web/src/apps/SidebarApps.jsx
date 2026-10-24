import React from "react";
import { NO_RUNTIME_TRANSLATE, useL } from "../app/i18n.js";
import { NavLink } from "react-router-dom";
import AppIcon from "../ui/AppIcon.jsx";
import useAppLinks from "./useAppLinks.js";
import { appIcon, isSafeAppUrl, resolveAppUrl } from "./appLinks.js";

function StatusDot({ status }) {
  const L = useL();
  if (!status) return <span className="snav-app__dot" aria-hidden="true" />;
  const label = status.online
    ? L("Elérhető", "Online", "En ligne")
    : `${L("Nem elérhető", "Offline", "Hors ligne")}${status.error ? `: ${status.error}` : ""}`;
  return (
    <span
      className={`snav-app__dot ${status.online ? "is-online" : "is-offline"}`}
      title={label}
      aria-label={label}
      role="img"
    />
  );
}

/**
 * Sidebar "Alkalmazások" section: one entry per enabled app link.
 * Embedded apps open at /apps/:id inside Poisonarr, the others in a new tab.
 */
export default function SidebarApps({ onNavigate }) {
  const L = useL();
  const { links, statusById, loaded } = useAppLinks();
  const enabled = links.filter((l) => l.enabled !== false && isSafeAppUrl(l.url));

  return (
    <div className="snav-apps" {...NO_RUNTIME_TRANSLATE}>
      <div className="snav-apps__head">
        <span>{L("Alkalmazások", "Apps", "Applications")}</span>
        <NavLink to="/settings/hub" className="snav-apps__manage" title={L("Alkalmazások kezelése", "Manage apps", "Gérer les applications")} onClick={onNavigate}>
          <AppIcon name="settings" />
        </NavLink>
      </div>

      {loaded && enabled.length === 0 && (
        <NavLink to="/settings/hub" className="snav__subitem snav-apps__empty" onClick={onNavigate}>
          + {L("Alkalmazások beállítása", "Set up apps", "Configurer les applications")}
        </NavLink>
      )}

      {enabled.map((link) => {
        const status = statusById[link.id];
        const content = (
          <>
            <AppIcon name={appIcon(link.type)} className="snav__icon" />
            <span className="snav__label">{link.name}</span>
            {link.openMode === "tab" && <AppIcon name="open_in_new" className="snav-app__ext" />}
            <StatusDot status={status} />
          </>
        );

        if (link.openMode === "tab") {
          return (
            <a
              key={link.id}
              className="snav__item snav-app"
              href={resolveAppUrl(link.url)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onNavigate}
            >
              {content}
            </a>
          );
        }

        return (
          <NavLink
            key={link.id}
            to={`/apps/${encodeURIComponent(link.id)}`}
            className={({ isActive }) => "snav__item snav-app" + (isActive ? " is-active" : "")}
            onClick={onNavigate}
          >
            {content}
          </NavLink>
        );
      })}
    </div>
  );
}
