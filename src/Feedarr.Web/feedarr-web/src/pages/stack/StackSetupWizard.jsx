import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "../../api/client.js";
import { applyUiLanguage, LANGUAGE_OPTIONS, normalizeUiLanguage } from "../../app/locale.js";
import { NO_RUNTIME_TRANSLATE, useL } from "../../app/i18n.js";
import ToggleSwitch from "../../ui/ToggleSwitch.jsx";
import AppIcon from "../../ui/AppIcon.jsx";
import { appIcon } from "../../apps/appLinks.js";
import { STACK_STEPS, appUrl, isValidUsername, passwordProblems, statusOf } from "./stackSetupModel.js";

const CREDS_KEY = "feedarr:stackSetup:creds";
const STEP_KEY = "feedarr:stackSetup:step";
const LANG_KEY = "feedarr:stackSetup:language";
const STACK_SKIP_KEY = "feedarr:stackSetup:skip";
const FEEDARR_SETUP_STEP_KEY = "feedarr:setupStep";
const LONG_TIMEOUT = { timeoutMs: 120000 };

function readSession(key, fallback) {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeSession(key, value) {
  try {
    if (value == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="stack-toggle">
      <ToggleSwitch checked={!!checked} onChange={(e) => onChange(!!e?.target?.checked)} title={label} />
      <span>
        <span className="stack-toggle__label">{label}</span>
        {hint && <span className="stack-toggle__hint">{hint}</span>}
      </span>
    </label>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="stack-field">
      <span className="stack-field__label">{label}</span>
      {children}
      {hint && <span className="stack-field__hint">{hint}</span>}
    </label>
  );
}

function Results({ result }) {
  if (!result) return null;
  return (
    <ul className="stack-results">
      {(result.steps || []).map((s, i) => (
        <li key={i} className={s.ok ? "is-ok" : "is-error"}>
          <span aria-hidden="true">{s.ok ? "✓" : "✕"}</span> {s.message}
        </li>
      ))}
    </ul>
  );
}

function AppHeader({ type, name, status, L }) {
  const port = status?.port;
  return (
    <div className="stack-apphead">
      <AppIcon name={appIcon(type)} className="stack-apphead__icon" />
      <div className="stack-apphead__text">
        <h2>{name}</h2>
        <div className="stack-apphead__status">
          {!status?.installed ? (
            <span className="stack-pill is-error">{L("nincs telepítve", "not installed", "non installé")}</span>
          ) : status.online ? (
            <span className="stack-pill is-ok">{L("fut", "running", "en marche")}</span>
          ) : (
            <span className="stack-pill is-error">{L("nem elérhető", "unreachable", "injoignable")}</span>
          )}
          {status?.configured && <span className="stack-pill is-ok">{L("beállítva", "configured", "configuré")}</span>}
          {(status?.details || []).map((d, i) => <span key={i} className="stack-detail">{d}</span>)}
        </div>
      </div>
      {port ? (
        <a className="btn" href={appUrl(port) + (type === "plex" ? "/web" : "")} target="_blank" rel="noopener noreferrer">
          <AppIcon name="open_in_new" /> {L("Megnyitás", "Open", "Ouvrir")}
        </a>
      ) : null}
    </div>
  );
}

function Embed({ port, title, height = 520 }) {
  if (!port) return null;
  return (
    <iframe
      className="stack-embed"
      src={appUrl(port)}
      title={title}
      style={{ height }}
      referrerPolicy="no-referrer"
      allow="fullscreen; clipboard-read; clipboard-write"
    />
  );
}

export default function StackSetupWizard() {
  const navigate = useNavigate();
  const L = useL();
  const [step, setStep] = useState(() => {
    const s = Number(readSession(STEP_KEY, 0));
    return Number.isInteger(s) && s >= 0 && s < STACK_STEPS.length ? s : 0;
  });
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState({});
  const [creds, setCreds] = useState(() => readSession(CREDS_KEY, null));
  const [form, setForm] = useState({
    language: "hu-HU",
    username: "",
    password: "",
    confirm: "",
    localWithoutLogin: true,
    hungarianUi: true,
    hungarianMetadata: true,
    moviesFolder: "/srv/media/movies",
    tvFolder: "/srv/media/tv",
    downloadsFolder: "/srv/media/downloads",
    ratioLimit: 0,
    plexClaim: "",
    plexName: "Poisonarr",
    plexLibraries: true,
  });

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await apiGet("/api/stack-setup/status", { timeoutMs: 30000 }));
    } catch (e) {
      setError(e?.message || "status");
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus, step]);
  useEffect(() => { writeSession(STEP_KEY, step); }, [step]);

  // The wizard starts in Hungarian unless the user already picked a language here.
  useEffect(() => {
    const chosen = readSession(LANG_KEY, null);
    const lang = normalizeUiLanguage(chosen || "hu-HU");
    setForm((f) => ({ ...f, language: lang }));
    applyUiLanguage(lang, true);
  }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const current = STACK_STEPS[step];
  const appStatus = current.type ? statusOf(status, current.type) : null;

  const pwProblems = passwordProblems(form.password);
  const pwRuleText = {
    length: L("legalább 12 karakter", "at least 12 characters", "au moins 12 caractères"),
    lower: L("kisbetű", "lower case letter", "minuscule"),
    upper: L("nagybetű", "upper case letter", "majuscule"),
    digit: L("számjegy", "digit", "chiffre"),
    symbol: L("speciális karakter", "symbol", "symbole"),
  };

  const startValid = isValidUsername(form.username) && pwProblems.length === 0 && form.password === form.confirm;

  const run = async (key, fn) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      setResults((prev) => ({ ...prev, [key]: r }));
      await loadStatus();
      return r;
    } catch (e) {
      setError(e?.message || L("A művelet nem sikerült.", "The action failed.", "L'action a échoué."));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveStart = async () => {
    const r = await run("start", async () => {
      const lang = normalizeUiLanguage(form.language);
      const ui = await apiGet("/api/settings/ui").catch(() => ({}));
      await apiPut("/api/settings/ui", { ...(ui || {}), uiLanguage: lang, mediaInfoLanguage: lang });
      applyUiLanguage(lang, true);
      await apiPut("/api/settings/security", {
        authMode: "smart",
        username: form.username.trim(),
        password: form.password,
        passwordConfirmation: form.confirm,
      });
      const c = { username: form.username.trim(), password: form.password };
      writeSession(CREDS_KEY, c);
      setCreds(c);
      return {
        steps: [
          { ok: true, message: L("Poisonarr nyelve és belépése elmentve.", "Poisonarr language and login saved.", "Langue et connexion Poisonarr enregistrées.") },
        ],
      };
    });
    if (r) setStep(1);
  };

  const credsBody = () => ({ username: creds?.username || form.username, password: creds?.password || form.password });

  const actions = {
    plex: () => run("plex", () => apiPost("/api/stack-setup/plex", {
      claimToken: form.plexClaim.trim() || null,
      serverName: form.plexName.trim() || null,
      createLibraries: form.plexLibraries,
      moviesPath: form.moviesFolder,
      tvPath: form.tvFolder,
      hungarian: form.hungarianUi,
    }, LONG_TIMEOUT)),
    radarr: () => run("radarr", () => apiPost("/api/stack-setup/radarr", {
      ...credsBody(),
      localNetworkWithoutLogin: form.localWithoutLogin,
      rootFolder: form.moviesFolder,
      hungarianUi: form.hungarianUi,
      hungarianMetadata: form.hungarianMetadata,
      addQbittorrent: true,
    }, LONG_TIMEOUT)),
    sonarr: () => run("sonarr", () => apiPost("/api/stack-setup/sonarr", {
      ...credsBody(),
      localNetworkWithoutLogin: form.localWithoutLogin,
      rootFolder: form.tvFolder,
      hungarianUi: form.hungarianUi,
      addQbittorrent: true,
    }, LONG_TIMEOUT)),
    prowlarr: () => run("prowlarr", () => apiPost("/api/stack-setup/prowlarr", {
      ...credsBody(),
      localNetworkWithoutLogin: form.localWithoutLogin,
      hungarianUi: form.hungarianUi,
      syncApps: true,
    }, LONG_TIMEOUT)),
    seerr: () => run("seerr", () => apiPost("/api/stack-setup/seerr", {
      hungarianUi: form.hungarianUi,
      connectArr: true,
      webhook: true,
    }, LONG_TIMEOUT)),
    qbittorrent: () => run("qbittorrent", () => apiPost("/api/stack-setup/qbittorrent", {
      ...credsBody(),
      savePath: form.downloadsFolder,
      tempPath: `${form.downloadsFolder.replace(/\/+$/, "")}/incomplete`,
      hungarianUi: form.hungarianUi,
      categories: true,
      ratioLimit: Number(form.ratioLimit) || 0,
    }, LONG_TIMEOUT)),
    tautulli: () => run("tautulli", () => apiPost("/api/stack-setup/tautulli", {}, LONG_TIMEOUT)),
  };

  const finish = async () => {
    const r = await run("feedarr", () => apiPost("/api/stack-setup/finish", {}, LONG_TIMEOUT));
    if (!r) return;
    writeSession(CREDS_KEY, null);
    writeSession(STEP_KEY, null);
    writeSession(LANG_KEY, null);
    try {
      // Language, intro and security are already done: continue Poisonarr's own wizard at "Providers".
      window.localStorage.setItem(FEEDARR_SETUP_STEP_KEY, "4");
    } catch { /* ignore */ }
    navigate("/setup", { replace: true });
  };

  const stepTitles = useMemo(() => ({
    start: L("Kezdés", "Start", "Début"),
    plex: "Plex",
    radarr: "Radarr",
    sonarr: "Sonarr",
    prowlarr: "Prowlarr",
    seerr: "Seerr",
    qbittorrent: "qBittorrent",
    tautulli: "Tautulli",
    feedarr: "Poisonarr",
  }), [L]);

  const needCreds = step > 0 && !creds;

  const renderStep = () => {
    switch (current.id) {
      case "start":
        return (
          <>
            <h2>{L("Üdv a Poisonarr beállítójában!", "Welcome to the Poisonarr setup", "Bienvenue dans la configuration Poisonarr")}</h2>
            <p className="muted">
              {L(
                "Végigmegyünk a programokon ebben a sorrendben: Plex, Radarr, Sonarr, Prowlarr, Seerr, qBittorrent, Tautulli, végül a Poisonarr. Egy közös felhasználónevet és jelszót adsz meg, ezt minden program megkapja.",
                "We go through the apps in this order: Plex, Radarr, Sonarr, Prowlarr, Seerr, qBittorrent, Tautulli and finally Poisonarr. You set one shared username and password for all of them.",
                "Nous configurons les applications dans cet ordre : Plex, Radarr, Sonarr, Prowlarr, Seerr, qBittorrent, Tautulli puis Poisonarr. Un identifiant et un mot de passe communs sont utilisés partout."
              )}
            </p>

            <div className="stack-apps-grid">
              {(status?.apps || []).map((a) => (
                <div key={a.type} className={`stack-appchip${a.online ? " is-ok" : ""}`}>
                  <AppIcon name={appIcon(a.type)} /> {a.name}
                  <span className="muted">:{a.port}</span>
                  <span className={`stack-dot ${a.online ? "is-ok" : "is-error"}`} />
                </div>
              ))}
            </div>

            <div className="stack-form">
              <Field label={L("Nyelv", "Language", "Langue")}>
                <select
                  value={form.language}
                  onChange={(e) => { set({ language: e.target.value }); writeSession(LANG_KEY, e.target.value); applyUiLanguage(e.target.value, true); }}
                >
                  {LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label={L("Felhasználónév", "Username", "Nom d'utilisateur")} hint={L("3–32 karakter: betű, szám, . _ -", "3–32 characters: letters, digits, . _ -", "3 à 32 caractères : lettres, chiffres, . _ -")}>
                <input type="text" autoComplete="username" value={form.username} onChange={(e) => set({ username: e.target.value })} />
              </Field>
              <Field
                label={L("Jelszó", "Password", "Mot de passe")}
                hint={pwProblems.length
                  ? `${L("Hiányzik", "Missing", "Manque")}: ${pwProblems.map((p) => pwRuleText[p]).join(", ")}`
                  : L("Erős jelszó ✓", "Strong password ✓", "Mot de passe fort ✓")}
              >
                <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} />
              </Field>
              <Field
                label={L("Jelszó újra", "Confirm password", "Confirmer le mot de passe")}
                hint={form.confirm && form.confirm !== form.password ? L("A két jelszó nem egyezik.", "Passwords do not match.", "Les mots de passe ne correspondent pas.") : null}
              >
                <input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set({ confirm: e.target.value })} />
              </Field>
            </div>
            <Toggle
              label={L("Helyi hálózatról ne kérjen jelszót (Radarr, Sonarr, Prowlarr)", "No password from the local network (Radarr, Sonarr, Prowlarr)", "Pas de mot de passe depuis le réseau local (Radarr, Sonarr, Prowlarr)")}
              hint={L("Így a Poisonarr-ba beágyazva is azonnal megnyílnak. Internet felől mindig kér jelszót.", "This way they open instantly when embedded in Poisonarr. From the internet a password is always required.", "Ainsi elles s'ouvrent directement dans Poisonarr. Depuis Internet un mot de passe reste requis.")}
              checked={form.localWithoutLogin}
              onChange={(v) => set({ localWithoutLogin: v })}
            />
            <Toggle
              label={L("Magyar felület mindenhol, ahol elérhető", "Hungarian UI wherever available", "Interface en hongrois quand c'est possible")}
              checked={form.hungarianUi}
              onChange={(v) => set({ hungarianUi: v })}
            />
            <p className="stack-note">
              {L(
                "Mentés után a böngésző egyszer bekéri ezt a felhasználónevet és jelszót – ez a Poisonarr belépése.",
                "After saving, your browser asks once for this username and password – that is the Poisonarr login.",
                "Après l'enregistrement, le navigateur demandera une fois cet identifiant – c'est la connexion Poisonarr."
              )}
            </p>
          </>
        );

      case "plex": {
        const claimed = (appStatus?.details || []).includes("fiókhoz rendelve");
        return (
          <>
            <AppHeader type="plex" name="Plex Media Server" status={appStatus} L={L} />
            <p className="muted">
              {L("A Plex játssza le a filmeket és sorozatokat a tévén, telefonon, böngészőben. Itt a fiókodhoz rendeljük a szervert, és létrehozzuk a Filmek és Sorozatok könyvtárat ugyanazokra a mappákra, ahová a Radarr és a Sonarr ment.",
                "Plex plays your movies and series on TV, phone and browser. Here the server is linked to your account and the Movies and TV libraries are created on the folders Radarr and Sonarr save to.",
                "Plex lit vos films et séries sur TV, téléphone et navigateur. Ici le serveur est lié à votre compte et les bibliothèques Films et Séries sont créées sur les dossiers de Radarr et Sonarr.")}
            </p>
            {!claimed && (
              <ol className="stack-todo">
                <li>
                  {L("Nyisd meg:", "Open:", "Ouvrez :")}{" "}
                  <a href="https://www.plex.tv/claim" target="_blank" rel="noopener noreferrer">plex.tv/claim</a>{" "}
                  {L("(jelentkezz be a Plex fiókoddal), és másold ki a kódot.", "(sign in with your Plex account) and copy the code.", "(connectez-vous avec votre compte Plex) et copiez le code.")}
                </li>
                <li>{L("Illeszd be lent, majd kattints a „Beállítás most” gombra. A kód 4 percig érvényes.", "Paste it below and click “Configure now”. The code is valid for 4 minutes.", "Collez-le ci-dessous puis cliquez sur « Configurer ». Le code est valable 4 minutes.")}</li>
              </ol>
            )}
            <div className="stack-form">
              {!claimed && (
                <Field label={L("Claim kód", "Claim code", "Code claim")} hint={L("claim-… kezdetű", "starts with claim-…", "commence par claim-…")}>
                  <input type="text" autoComplete="off" spellCheck={false} placeholder="claim-xxxxxxxxxxxxxxxxxxxx"
                    value={form.plexClaim} onChange={(e) => set({ plexClaim: e.target.value })} />
                </Field>
              )}
              <Field label={L("Szerver neve", "Server name", "Nom du serveur")}>
                <input type="text" value={form.plexName} onChange={(e) => set({ plexName: e.target.value })} />
              </Field>
            </div>
            <Toggle
              label={L("Filmek és Sorozatok könyvtár létrehozása", "Create Movies and TV libraries", "Créer les bibliothèques Films et Séries")}
              hint={`${form.moviesFolder} · ${form.tvFolder}${form.hungarianUi ? L(" · magyar metaadatok", " · Hungarian metadata", " · métadonnées hongroises") : ""}`}
              checked={form.plexLibraries}
              onChange={(v) => set({ plexLibraries: v })}
            />
            <button type="button" className="btn btn-accent"
              disabled={busy || !appStatus?.online || (!claimed && !form.plexClaim.trim().startsWith("claim-"))}
              onClick={actions.plex}>
              {busy ? L("Beállítás…", "Configuring…", "Configuration…") : L("Beállítás most", "Configure now", "Configurer")}
            </button>
            <Results result={results.plex} />
            <p className="stack-note">
              {L("Hardveres átkódoláshoz (Intel/AMD GPU) a Proxmoxban a konténernek át kell adni a /dev/dri eszközt – lásd a README-t.",
                "For hardware transcoding (Intel/AMD GPU) pass /dev/dri to the container in Proxmox – see the README.",
                "Pour le transcodage matériel (GPU Intel/AMD), transmettez /dev/dri au conteneur dans Proxmox – voir le README.")}
            </p>
          </>
        );
      }

      case "radarr":
      case "sonarr": {
        const isRadarr = current.id === "radarr";
        return (
          <>
            <AppHeader type={current.id} name={isRadarr ? "Radarr" : "Sonarr"} status={appStatus} L={L} />
            <p className="muted">
              {isRadarr
                ? L("A Radarr kezeli a filmeket: keresi, letölti (qBittorrenttel) és rendezi őket.", "Radarr manages movies: searches, downloads (via qBittorrent) and organises them.", "Radarr gère les films : recherche, téléchargement (via qBittorrent) et rangement.")
                : L("A Sonarr ugyanezt csinálja a sorozatokkal.", "Sonarr does the same for TV series.", "Sonarr fait de même pour les séries.")}
            </p>
            <div className="stack-form">
              <Field label={isRadarr ? L("Filmek mappája", "Movies folder", "Dossier des films") : L("Sorozatok mappája", "Series folder", "Dossier des séries")}>
                <input
                  type="text"
                  value={isRadarr ? form.moviesFolder : form.tvFolder}
                  onChange={(e) => set(isRadarr ? { moviesFolder: e.target.value } : { tvFolder: e.target.value })}
                />
              </Field>
            </div>
            {isRadarr && (
              <Toggle
                label={L("Magyar film adatok (címek, leírások)", "Hungarian movie metadata (titles, overviews)", "Métadonnées des films en hongrois")}
                checked={form.hungarianMetadata}
                onChange={(v) => set({ hungarianMetadata: v })}
              />
            )}
            <ul className="stack-todo">
              <li>{L("Belépés: a közös felhasználó és jelszó", "Login: the shared username and password", "Connexion : identifiant commun")}</li>
              <li>{L("Gyökérmappa létrehozása", "Root folder", "Dossier racine")}</li>
              <li>{L("qBittorrent letöltő kliensként", "qBittorrent as download client", "qBittorrent comme client de téléchargement")}</li>
              {form.hungarianUi && <li>{L("Magyar felület", "Hungarian UI", "Interface en hongrois")}</li>}
              <li>{L("Bekötés a Poisonarr-ba", "Connection to Poisonarr", "Connexion à Poisonarr")}</li>
            </ul>
            <button type="button" className="btn btn-accent" disabled={busy || !appStatus?.online} onClick={actions[current.id]}>
              {busy ? L("Beállítás…", "Configuring…", "Configuration…") : L("Beállítás most", "Configure now", "Configurer")}
            </button>
            <Results result={results[current.id]} />
          </>
        );
      }

      case "prowlarr":
        return (
          <>
            <AppHeader type="prowlarr" name="Prowlarr" status={appStatus} L={L} />
            <p className="muted">
              {L("A Prowlarr kezeli az indexereket (torrent oldalakat), és továbbadja őket a Sonarrnak, a Radarrnak és a Poisonarr-nak.",
                "Prowlarr manages the indexers (torrent sites) and shares them with Sonarr, Radarr and Poisonarr.",
                "Prowlarr gère les indexeurs et les partage avec Sonarr, Radarr et Poisonarr.")}
            </p>
            <ol className="stack-todo">
              <li>{L("Kattints a „Beállítás most” gombra (belépés, nyelv, Sonarr/Radarr szinkron, Poisonarr).", "Click “Configure now” (login, language, Sonarr/Radarr sync, Poisonarr).", "Cliquez sur « Configurer » (connexion, langue, synchro Sonarr/Radarr, Poisonarr).")}</li>
              <li>{L("Lent a Prowlarrban: Indexers → Add Indexer → válaszd ki az oldalaidat (pl. nCore) és add meg a belépésüket.", "Below in Prowlarr: Indexers → Add Indexer → pick your sites (e.g. nCore) and enter their login.", "Dans Prowlarr ci-dessous : Indexers → Add Indexer → choisissez vos sites et leurs identifiants.")}</li>
            </ol>
            <button type="button" className="btn btn-accent" disabled={busy || !appStatus?.online} onClick={actions.prowlarr}>
              {busy ? L("Beállítás…", "Configuring…", "Configuration…") : L("Beállítás most", "Configure now", "Configurer")}
            </button>
            <Results result={results.prowlarr} />
            <Embed port={appStatus?.port} title="Prowlarr" />
          </>
        );

      case "seerr":
        return (
          <>
            <AppHeader type="seerr" name="Seerr" status={appStatus} L={L} />
            <ol className="stack-todo">
              <li>{L("Lent a Seerrben: „Sign in with Plex” → válaszd ki a Plex szervert és a könyvtárakat. A Sonarr/Radarr lépést a Seerrben kihagyhatod.",
                "Below in Seerr: “Sign in with Plex” → choose the Plex server and libraries. You can skip the Sonarr/Radarr page in Seerr.",
                "Dans Seerr ci-dessous : « Sign in with Plex » → choisissez le serveur et les bibliothèques. Vous pouvez passer l'étape Sonarr/Radarr.")}</li>
              <li>{L("Utána itt: „Bekötés most” – a Poisonarr beállítja a Sonarrt, a Radarrt, a magyar nyelvet és a webhookot.",
                "Then here: “Connect now” – Poisonarr sets up Sonarr, Radarr, the language and the webhook.",
                "Puis ici : « Connecter » – Poisonarr configure Sonarr, Radarr, la langue et le webhook.")}</li>
            </ol>
            <button type="button" className="btn btn-accent" disabled={busy || !appStatus?.online} onClick={actions.seerr}>
              {busy ? L("Bekötés…", "Connecting…", "Connexion…") : L("Bekötés most", "Connect now", "Connecter")}
            </button>
            <Results result={results.seerr} />
            <Embed port={appStatus?.port} title="Seerr" height={600} />
          </>
        );

      case "qbittorrent":
        return (
          <>
            <AppHeader type="qbittorrent" name="qBittorrent" status={appStatus} L={L} />
            <div className="stack-form">
              <Field label={L("Letöltések mappája", "Downloads folder", "Dossier des téléchargements")}>
                <input type="text" value={form.downloadsFolder} onChange={(e) => set({ downloadsFolder: e.target.value })} />
              </Field>
              <Field label={L("Seedelés leállítása ennél az aránynál", "Stop seeding at ratio", "Arrêter le partage au ratio")} hint={L("0 = korlátlan. Zárt oldalaknál (pl. nCore) tartsd be a szabályokat!", "0 = unlimited. Respect the rules of private trackers!", "0 = illimité. Respectez les règles des trackers privés !")}>
                <input type="number" min={0} step={0.1} value={form.ratioLimit} onChange={(e) => set({ ratioLimit: e.target.value })} />
              </Field>
            </div>
            <ul className="stack-todo">
              <li>{L("WebUI felhasználó és jelszó: a közös belépés", "WebUI username and password: the shared login", "Identifiants WebUI : connexion commune")}</li>
              <li>{L("Mentési mappa, ideiglenes mappa, radarr/sonarr kategóriák", "Save path, temporary path, radarr/sonarr categories", "Dossiers et catégories radarr/sonarr")}</li>
              <li>{L("Beágyazás engedélyezése a Poisonarr-ban", "Allow embedding in Poisonarr", "Autoriser l'intégration dans Poisonarr")}</li>
            </ul>
            <button type="button" className="btn btn-accent" disabled={busy || !appStatus?.online} onClick={actions.qbittorrent}>
              {busy ? L("Beállítás…", "Configuring…", "Configuration…") : L("Beállítás most", "Configure now", "Configurer")}
            </button>
            <Results result={results.qbittorrent} />
          </>
        );

      case "tautulli":
        return (
          <>
            <AppHeader type="tautulli" name="Tautulli" status={appStatus} L={L} />
            <ol className="stack-todo">
              <li>{L("Lent a Tautulli varázslójában: jelentkezz be a Plex fiókoddal és válaszd ki a szervert.",
                "Below in the Tautulli wizard: sign in with Plex and choose your server.",
                "Dans l'assistant Tautulli ci-dessous : connectez-vous à Plex et choisissez le serveur.")}</li>
              <li>{L("Utána: „Ellenőrzés”.", "Then: “Check”.", "Puis : « Vérifier ».")}</li>
            </ol>
            <button type="button" className="btn btn-accent" disabled={busy || !appStatus?.online} onClick={actions.tautulli}>
              {busy ? L("Ellenőrzés…", "Checking…", "Vérification…") : L("Ellenőrzés", "Check", "Vérifier")}
            </button>
            <Results result={results.tautulli} />
            <Embed port={appStatus?.port} title="Tautulli" height={600} />
          </>
        );

      case "feedarr":
        return (
          <>
            <div className="stack-apphead">
              <img src={`${import.meta.env.BASE_URL}poisonarr-logo.svg`} alt="" className="stack-apphead__icon stack-apphead__logo" />
              <div className="stack-apphead__text"><h2>Poisonarr</h2></div>
            </div>
            <p className="muted">
              {L("Az utolsó lépésben a Poisonarr bekapcsolja az „Alkalmazások” menüt az oldalsávban, és felveszi a Prowlarrt, a Sonarrt és a Radarrt. Ezután a Poisonarr saját beállításai jönnek (metaadat szolgáltatók, indexerek kiválasztása).",
                "In the last step Poisonarr creates the sidebar “Apps” menu and registers Prowlarr, Sonarr and Radarr. Then Poisonarr's own settings follow (metadata providers, choosing indexers).",
                "Dernière étape : Poisonarr crée le menu « Applications » et enregistre Prowlarr, Sonarr et Radarr. Ensuite viennent les réglages propres à Poisonarr (métadonnées, indexeurs).")}
            </p>
            <div className="stack-summary">
              {(status?.apps || []).map((a) => (
                <div key={a.type} className={`stack-appchip${a.configured ? " is-ok" : ""}`}>
                  <AppIcon name={appIcon(a.type)} /> {a.name}
                  <span className="muted">{a.configured ? L("beállítva", "configured", "configuré") : L("kész lehet később is", "can be finished later", "à terminer plus tard")}</span>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-accent" disabled={busy} onClick={finish}>
              {busy ? L("Befejezés…", "Finishing…", "Finalisation…") : L("Befejezés és tovább a Poisonarr beállításaihoz", "Finish and continue with Poisonarr settings", "Terminer et continuer vers les réglages Poisonarr")}
            </button>
            <Results result={results.feedarr} />
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="setup-container stack-setup" {...NO_RUNTIME_TRANSLATE}>
      <div className="setup-stepper">
        {STACK_STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`setup-stepper-item${i === step ? " is-active" : ""}${i < step ? " is-done" : ""}`}
            onClick={() => (i === 0 || creds) && setStep(i)}
            disabled={i !== 0 && !creds}
            aria-current={i === step ? "step" : undefined}
          >
            <span className="setup-stepper-num">{i + 1}</span>
            <span className="setup-stepper-label">{stepTitles[s.id]}</span>
          </button>
        ))}
      </div>

      <div className="setup-card setupWizardFrame">
        <div className="setupWizardBody">
          <div className="setup-card__content">
            {needCreds ? (
              <div className="errorbox">
                <div className="errorbox__title">{L("Add meg újra a közös belépést", "Enter the shared login again", "Saisissez à nouveau l'identifiant commun")}</div>
                <div className="muted">
                  {L("A böngésző újratöltése törölte a megadott jelszót. Lépj vissza az 1. lépésre.", "Reloading the page cleared the password. Go back to step 1.", "Le rechargement a effacé le mot de passe. Revenez à l'étape 1.")}
                </div>
              </div>
            ) : renderStep()}
            {error && <div className="stack-error">{error}</div>}
          </div>
        </div>

        <div className="setupWizardFooter">
          <div className="setup-actions">
            {step > 0 && (
              <button className="btn" type="button" onClick={() => setStep(step - 1)} disabled={busy}>
                {L("Vissza", "Previous", "Précédent")}
              </button>
            )}
            <div className="setup-actions-right" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {step === 0 && (
                <button className="btn" type="button" onClick={() => { writeSession(STACK_SKIP_KEY, true); navigate("/setup"); }} disabled={busy}>
                  {L("Kihagyás", "Skip", "Passer")}
                </button>
              )}
              {step === 0 ? (
                <button className="btn btn-accent" type="button" onClick={saveStart} disabled={busy || !startValid}>
                  {busy ? L("Mentés…", "Saving…", "Enregistrement…") : L("Mentés és tovább", "Save and continue", "Enregistrer et continuer")}
                </button>
              ) : step < STACK_STEPS.length - 1 ? (
                <button className="btn btn-accent" type="button" onClick={() => setStep(step + 1)} disabled={busy || needCreds}>
                  {results[current.id]?.ok || appStatus?.configured ? L("Tovább", "Next", "Suivant") : L("Kihagyás / tovább", "Skip / next", "Passer / suivant")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
