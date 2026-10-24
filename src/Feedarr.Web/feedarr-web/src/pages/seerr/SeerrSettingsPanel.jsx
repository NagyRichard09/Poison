import React, { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../api/client.js";
import ToggleSwitch from "../../ui/ToggleSwitch.jsx";

const card = {
  background: "var(--bg2)", border: "1px solid var(--border)",
  borderRadius: 10, padding: "1rem 1.25rem", marginBottom: "1rem",
  fontSize: 13, color: "var(--text2)",
};
const rowStyle = { display: "flex", alignItems: "center", gap: 12, padding: "6px 0" };
const labelStyle = { flex: 1, minWidth: 0 };
const hintStyle = { fontSize: 11, color: "var(--muted)", marginTop: 2 };
const inputStyle = {
  width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--bg3, var(--bg))", color: "var(--text)",
};
const buttonStyle = {
  fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--bg3, var(--bg2))", color: "var(--text)", cursor: "pointer",
};
const primaryButton = { ...buttonStyle, background: "#0F6E56", color: "#fff", border: "none" };

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
  const cleared = value === "";
  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ color: "var(--text)", marginBottom: 4 }}>
        {label}
        {configured && value == null && (
          <span style={{ marginLeft: 8, fontSize: 11, color: "#0F6E56" }}>
            ✓ beállítva{display ? ` (${display})` : ""}
          </span>
        )}
        {cleared && configured && (
          <span style={{ marginLeft: 8, fontSize: 11, color: "#A32D2D" }}>mentéskor törlődik</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="password"
          autoComplete="off"
          style={inputStyle}
          placeholder={configured ? "•••••• (változatlan)" : placeholder}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
        {configured && (
          <button type="button" style={buttonStyle} onClick={() => onChange(cleared ? null : "")}>
            {cleared ? "Mégse" : "Törlés"}
          </button>
        )}
      </div>
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}

export default function SeerrSettingsPanel({ onSaved }) {
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
      .catch((e) => alive && setMsg({ error: true, text: e?.message || "Betöltési hiba" }));
    return () => { alive = false; };
  }, []);

  if (!seerr || !notif) {
    return <div style={card}>{msg?.text || "Beállítások betöltése…"}</div>;
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
      setMsg({ error: false, text: "Beállítások elmentve." });
      onSaved?.();
    } catch (e) {
      setMsg({ error: true, text: e?.message || "Mentési hiba" });
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    setMsg(null);
    try {
      const r = await apiPost("/api/notifications/test", notificationBody());
      const parts = (r?.results || []).map((x) => `${x.channel}: ${x.ok ? "OK" : `hiba – ${x.error || "?"}`}`);
      setMsg({ error: !r?.ok, text: parts.length ? parts.join(" · ") : "Nincs csatorna." });
    } catch (e) {
      setMsg({ error: true, text: e?.message || "Teszt hiba" });
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={card}>
      <strong style={{ color: "var(--text)", display: "block", marginBottom: 6 }}>⚙️ Egyeztetés és Sonarr/Radarr</strong>
      <ToggleRow
        label="Automatikus küldés Sonarr/Radarr-ba"
        hint="Egyezés után a release a release/push API-n megy át; a Sonarr/Radarr a minőségprofil alapján dönt a letöltésről."
        checked={seerr.autoPushToArr}
        onChange={(v) => setSeerr({ ...seerr, autoPushToArr: v })}
      />
      <ToggleRow
        label="Magyar release előnyben"
        hint="HUN / magyar felirat-hang címkés release-ek kerülnek előre."
        checked={seerr.preferHungarian}
        onChange={(v) => setSeerr({ ...seerr, preferHungarian: v })}
      />
      <ToggleRow
        label="Szigorú évad-egyeztetés"
        hint="Sorozatnál csak a kért évad(ok) vagy évad nélküli csomagok fogadhatók el."
        checked={seerr.strictSeasonMatch}
        onChange={(v) => setSeerr({ ...seerr, strictSeasonMatch: v })}
      />
      <div style={rowStyle}>
        <div style={labelStyle}>
          <div style={{ color: "var(--text)" }}>Minimum seeder</div>
          <div style={hintStyle}>Ennél kevesebb seederrel rendelkező release-t nem választ (0 = nincs korlát).</div>
        </div>
        <input
          type="number" min={0} max={10000} style={{ ...inputStyle, width: 90 }}
          value={seerr.minSeeders ?? 0}
          onChange={(e) => setSeerr({ ...seerr, minSeeders: e.target.value })}
        />
      </div>

      <strong style={{ color: "var(--text)", display: "block", margin: "14px 0 6px" }}>🔔 Értesítések</strong>
      <ToggleRow
        label="Értesítések engedélyezése"
        checked={notif.enabled}
        onChange={(v) => setNotif({ ...notif, enabled: v })}
      />
      <SecretField
        label="Discord webhook URL"
        placeholder="https://discord.com/api/webhooks/…"
        hint="Discord: csatorna beállítások → Integrációk → Webhookok."
        configured={notif.hasDiscordWebhookUrl}
        value={secrets.discordWebhookUrl}
        onChange={(v) => setSecret("discordWebhookUrl", v)}
      />
      <SecretField
        label="ntfy topic URL"
        placeholder="https://ntfy.sh/feedarr-titkos-topic"
        hint="Saját szerver is lehet (pl. http://ntfy.lan/feedarr)."
        configured={notif.hasNtfyTopicUrl}
        display={notif.ntfyTopicDisplay}
        value={secrets.ntfyTopicUrl}
        onChange={(v) => setSecret("ntfyTopicUrl", v)}
      />
      <SecretField
        label="ntfy access token (opcionális)"
        placeholder="tk_…"
        configured={notif.hasNtfyToken}
        value={secrets.ntfyToken}
        onChange={(v) => setSecret("ntfyToken", v)}
      />
      <SecretField
        label="Általános webhook URL (opcionális)"
        placeholder="https://home-assistant.lan/api/webhook/feedarr"
        hint="JSON POST: event, title, message, url, imageUrl, data."
        configured={notif.hasWebhookUrl}
        display={notif.webhookDisplay}
        value={secrets.webhookUrl}
        onChange={(v) => setSecret("webhookUrl", v)}
      />
      <ToggleRow label="Új Seerr kérés" checked={notif.onSeerrRequest}
        onChange={(v) => setNotif({ ...notif, onSeerrRequest: v })} />
      <ToggleRow label="Megérkezett a kért tartalom (egyezés)" checked={notif.onSeerrMatch}
        onChange={(v) => setNotif({ ...notif, onSeerrMatch: v })} />
      <ToggleRow label="Sonarr/Radarr küldés eredménye" checked={notif.onArrPush}
        onChange={(v) => setNotif({ ...notif, onArrPush: v })} />

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={primaryButton} disabled={!!busy} onClick={save}>
          {busy === "save" ? "Mentés…" : "Mentés"}
        </button>
        <button type="button" style={buttonStyle} disabled={!!busy} onClick={test}>
          {busy === "test" ? "Küldés…" : "Teszt értesítés"}
        </button>
        {msg && (
          <span style={{ fontSize: 12, color: msg.error ? "#A32D2D" : "#0F6E56" }}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
