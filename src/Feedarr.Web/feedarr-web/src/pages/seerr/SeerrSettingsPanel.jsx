import React, { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../api/client.js";
import ToggleSwitch from "../../ui/ToggleSwitch.jsx";
import { NO_RUNTIME_TRANSLATE, useL } from "../../app/i18n.js";

const card = {
  background: "var(--panel)", border: "1px solid var(--panel-border)",
  borderRadius: 10, padding: "1rem 1.25rem", marginBottom: "1rem",
  fontSize: 13, color: "var(--muted)",
};
const rowStyle = { display: "flex", alignItems: "center", gap: 12, padding: "6px 0" };
const labelStyle = { flex: 1, minWidth: 0 };
const hintStyle = { fontSize: 11, color: "var(--muted)", marginTop: 2 };
const inputStyle = {
  width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", borderRadius: 6,
  border: "1px solid var(--panel-border)", background: "var(--input-bg)", color: "var(--text)",
};
const buttonStyle = {
  fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--panel-border)",
  background: "var(--panel-soft)", color: "var(--text)", cursor: "pointer",
};
const primaryButton = { ...buttonStyle, background: "var(--accent-fill)", color: "var(--on-accent)", border: "none", fontWeight: 700 };

function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <div style={rowStyle}>
      <div style={labelStyle}>
        <div style={{ color: "var(--text)" }}>{label}</div>
        {hint && <div style={hintStyle}>{hint}</div>}
      </div>
      <ToggleSwitch checked={!!checked} onChange={(e) => onChange(!!e?.target?.checked)} title={label} />
    </div>
  );
}

/**
 * Secret input: shows "beállítva" when a value is stored. Leaving it untouched keeps
 * the stored value (null is sent), the "Törlés" button clears it ("" is sent).
 */
function SecretField({ label, hint, placeholder, configured, display, value, onChange }) {
  const L = useL();
  const cleared = value === "";
  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ color: "var(--text)", marginBottom: 4 }}>
        {label}
        {configured && value == null && (
          <span style={{ marginLeft: 8, fontSize: 11, color: "#2bd96b" }}>
            ✓ {L("beállítva", "set", "défini")}{display ? ` (${display})` : ""}
          </span>
        )}
        {cleared && configured && (
          <span style={{ marginLeft: 8, fontSize: 11, color: "#e5484d" }}>{L("mentéskor törlődik", "cleared on save", "effacé à l'enregistrement")}</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="password"
          autoComplete="off"
          style={inputStyle}
          placeholder={configured ? `•••••• (${L("változatlan", "unchanged", "inchangé")})` : placeholder}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
        {configured && (
          <button type="button" style={buttonStyle} onClick={() => onChange(cleared ? null : "")}>
            {cleared ? L("Mégse", "Cancel", "Annuler") : L("Törlés", "Clear", "Effacer")}
          </button>
        )}
      </div>
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}

export default function SeerrSettingsPanel({ onSaved }) {
  const L = useL();
  const [seerr, setSeerr] = useState(null);
  const [notif, setNotif] = useState(null);
  // Secret edits: undefined/null = unchanged, "" = clear, string = new value
  const [secrets, setSecrets] = useState({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([apiGet("/api/seerr/settings"), apiGet("/api/notifications/settings")])
      .then(([s, n]) => {
        if (!alive) return;
        setSeerr(s || {});
        setNotif(n || {});
      })
      .catch((e) => alive && setMsg({ error: true, text: e?.message || "load error" }));
    return () => { alive = false; };
  }, []);

  if (!seerr || !notif) {
    return <div style={card} {...NO_RUNTIME_TRANSLATE}>{msg?.text || L("Beállítások betöltése…", "Loading settings…", "Chargement des paramètres…")}</div>;
  }

  const setSecret = (key, value) => setSecrets((prev) => ({ ...prev, [key]: value }));

  const notificationBody = () => ({
    enabled: !!notif.enabled,
    onSeerrRequest: !!notif.onSeerrRequest,
    onSeerrMatch: !!notif.onSeerrMatch,
    onArrPush: !!notif.onArrPush,
    discordWebhookUrl: secrets.discordWebhookUrl ?? null,
    ntfyTopicUrl: secrets.ntfyTopicUrl ?? null,
    ntfyToken: secrets.ntfyToken ?? null,
    webhookUrl: secrets.webhookUrl ?? null,
  });

  const save = async () => {
    setBusy("save");
    setMsg(null);
    try {
      const [s, n] = await Promise.all([
        apiPut("/api/seerr/settings", {
          autoPushToArr: !!seerr.autoPushToArr,
          preferHungarian: !!seerr.preferHungarian,
          strictSeasonMatch: !!seerr.strictSeasonMatch,
          minSeeders: Math.max(0, Number(seerr.minSeeders) || 0),
        }),
        apiPut("/api/notifications/settings", notificationBody()),
      ]);
      setSeerr(s || seerr);
      setNotif(n || notif);
      setSecrets({});
      setMsg({ error: false, text: L("Beállítások elmentve.", "Settings saved.", "Paramètres enregistrés.") });
      onSaved?.();
    } catch (e) {
      setMsg({ error: true, text: e?.message || L("Mentési hiba", "Save error", "Erreur d'enregistrement") });
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    setMsg(null);
    try {
      const r = await apiPost("/api/notifications/test", notificationBody());
      const parts = (r?.results || []).map((x) => `${x.channel}: ${x.ok ? "OK" : `${L("hiba", "error", "erreur")} – ${x.error || "?"}`}`);
      setMsg({ error: !r?.ok, text: parts.length ? parts.join(" · ") : L("Nincs csatorna.", "No channel.", "Aucun canal.") });
    } catch (e) {
      setMsg({ error: true, text: e?.message || L("Teszt hiba", "Test error", "Erreur de test") });
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={card} {...NO_RUNTIME_TRANSLATE}>
      <strong style={{ color: "var(--text)", display: "block", marginBottom: 6 }}>⚙️ {L("Egyeztetés és Sonarr/Radarr", "Matching and Sonarr/Radarr", "Association et Sonarr/Radarr")}</strong>
      <ToggleRow
        label={L("Automatikus küldés Sonarr/Radarr-ba", "Send to Sonarr/Radarr automatically", "Envoi automatique vers Sonarr/Radarr")}
        hint={L("Egyezés után a release a release/push API-n megy át; a Sonarr/Radarr a minőségprofil alapján dönt a letöltésről.", "After a match the release goes through the release/push API; Sonarr/Radarr decide about the download based on the quality profile.", "Après une association, la release passe par l'API release/push ; Sonarr/Radarr décident du téléchargement selon le profil de qualité.")}
        checked={seerr.autoPushToArr}
        onChange={(v) => setSeerr({ ...seerr, autoPushToArr: v })}
      />
      <ToggleRow
        label={L("Magyar release előnyben", "Prefer Hungarian releases", "Préférer les releases hongroises")}
        hint={L("HUN / magyar felirat-hang címkés release-ek kerülnek előre.", "Releases tagged HUN / Hungarian audio or subtitles come first.", "Les releases marquées HUN / audio ou sous-titres hongrois passent en premier.")}
        checked={seerr.preferHungarian}
        onChange={(v) => setSeerr({ ...seerr, preferHungarian: v })}
      />
      <ToggleRow
        label={L("Szigorú évad-egyeztetés", "Strict season matching", "Association stricte des saisons")}
        hint={L("Sorozatnál csak a kért évad(ok) vagy évad nélküli csomagok fogadhatók el.", "For series only the requested season(s) or packs without a season are accepted.", "Pour les séries, seules la ou les saisons demandées ou les packs sans saison sont acceptés.")}
        checked={seerr.strictSeasonMatch}
        onChange={(v) => setSeerr({ ...seerr, strictSeasonMatch: v })}
      />
      <div style={rowStyle}>
        <div style={labelStyle}>
          <div style={{ color: "var(--text)" }}>{L("Minimum seeder", "Minimum seeders", "Seeders minimum")}</div>
          <div style={hintStyle}>{L("Ennél kevesebb seederrel rendelkező release-t nem választ (0 = nincs korlát).", "Releases with fewer seeders are not picked (0 = no limit).", "Les releases avec moins de seeders ne sont pas choisies (0 = pas de limite).")}</div>
        </div>
        <input
          type="number" min={0} max={10000} style={{ ...inputStyle, width: 90 }}
          value={seerr.minSeeders ?? 0}
          onChange={(e) => setSeerr({ ...seerr, minSeeders: e.target.value })}
        />
      </div>

      <strong style={{ color: "var(--text)", display: "block", margin: "14px 0 6px" }}>🔔 {L("Értesítések", "Notifications", "Notifications")}</strong>
      <ToggleRow
        label={L("Értesítések engedélyezése", "Enable notifications", "Activer les notifications")}
        checked={notif.enabled}
        onChange={(v) => setNotif({ ...notif, enabled: v })}
      />
      <SecretField
        label="Discord webhook URL"
        placeholder="https://discord.com/api/webhooks/…"
        hint={L("Discord: csatorna beállítások → Integrációk → Webhookok.", "Discord: channel settings → Integrations → Webhooks.", "Discord : paramètres du salon → Intégrations → Webhooks.")}
        configured={notif.hasDiscordWebhookUrl}
        value={secrets.discordWebhookUrl}
        onChange={(v) => setSecret("discordWebhookUrl", v)}
      />
      <SecretField
        label="ntfy topic URL"
        placeholder="https://ntfy.sh/feedarr-titkos-topic"
        hint={L("Saját szerver is lehet (pl. http://ntfy.lan/feedarr).", "A self-hosted server works too (e.g. http://ntfy.lan/feedarr).", "Un serveur auto-hébergé fonctionne aussi (ex. http://ntfy.lan/feedarr).")}
        configured={notif.hasNtfyTopicUrl}
        display={notif.ntfyTopicDisplay}
        value={secrets.ntfyTopicUrl}
        onChange={(v) => setSecret("ntfyTopicUrl", v)}
      />
      <SecretField
        label={L("ntfy access token (opcionális)", "ntfy access token (optional)", "Jeton d'accès ntfy (facultatif)")}
        placeholder="tk_…"
        configured={notif.hasNtfyToken}
        value={secrets.ntfyToken}
        onChange={(v) => setSecret("ntfyToken", v)}
      />
      <SecretField
        label={L("Általános webhook URL (opcionális)", "Generic webhook URL (optional)", "URL de webhook générique (facultatif)")}
        placeholder="https://home-assistant.lan/api/webhook/feedarr"
        hint="JSON POST: event, title, message, url, imageUrl, data."
        configured={notif.hasWebhookUrl}
        display={notif.webhookDisplay}
        value={secrets.webhookUrl}
        onChange={(v) => setSecret("webhookUrl", v)}
      />
      <ToggleRow label={L("Új Seerr kérés", "New Seerr request", "Nouvelle demande Seerr")} checked={notif.onSeerrRequest}
        onChange={(v) => setNotif({ ...notif, onSeerrRequest: v })} />
      <ToggleRow label={L("Megérkezett a kért tartalom (egyezés)", "Requested content arrived (match)", "Contenu demandé disponible (association)")} checked={notif.onSeerrMatch}
        onChange={(v) => setNotif({ ...notif, onSeerrMatch: v })} />
      <ToggleRow label={L("Sonarr/Radarr küldés eredménye", "Sonarr/Radarr send result", "Résultat de l'envoi Sonarr/Radarr")} checked={notif.onArrPush}
        onChange={(v) => setNotif({ ...notif, onArrPush: v })} />

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={primaryButton} disabled={!!busy} onClick={save}>
          {busy === "save" ? L("Mentés…", "Saving…", "Enregistrement…") : L("Mentés", "Save", "Enregistrer")}
        </button>
        <button type="button" style={buttonStyle} disabled={!!busy} onClick={test}>
          {busy === "test" ? L("Küldés…", "Sending…", "Envoi…") : L("Teszt értesítés", "Test notification", "Notification de test")}
        </button>
        {msg && (
          <span style={{ fontSize: 12, color: msg.error ? "#e5484d" : "#2bd96b" }}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
