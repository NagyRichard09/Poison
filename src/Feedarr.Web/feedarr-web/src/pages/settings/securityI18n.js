import { getActiveUiLanguage } from "../../app/locale.js";
import { tr } from "../../app/uiText.js";

const SECURITY_TEXT = {
  "settings.security.title": { fr: "Authentification", en: "Authentication", hu: "Hitelesítés" },
  "settings.security.authMode": { fr: "Mode d'authentification", en: "Auth mode", hu: "Hitelesítési mód" },
  "settings.security.authMode.none": { fr: "Aucune", en: "Open", hu: "Nincs" },
  "settings.security.authMode.smart": { fr: "Smart", en: "Smart", hu: "Intelligens" },
  "settings.security.authMode.strict": { fr: "Stricte", en: "Strict", hu: "Szigorú" },
  "settings.security.authMode.open": { fr: "Aucune", en: "Open", hu: "Nyitott" },
  "settings.security.help.smartExposure": {
    fr: "Le mode Smart protège automatiquement quand l'instance est exposée.",
    en: "Smart mode automatically protects when the instance is exposed.",
    hu: "Az intelligens mód automatikusan véd, ha a példány kívülről elérhető.",
  },
  "settings.security.publicBaseUrl": { fr: "URL publique de base", en: "Public base URL", hu: "Nyilvános alap URL" },
  "settings.security.status": { fr: "Statut", en: "Status", hu: "Állapot" },
  "settings.security.status.configured": { fr: "Configuré", en: "Configured", hu: "Konfigurálva" },
  "settings.security.status.notConfigured": { fr: "Non configuré", en: "Not configured", hu: "Nincs konfigurálva" },
  "settings.security.status.authRequired": { fr: "Auth requise", en: "Auth required", hu: "Hitelesítés szükséges" },
  "settings.security.status.authNotRequired": { fr: "Auth non requise", en: "Auth not required", hu: "Hitelesítés nem szükséges" },
  "settings.security.username": { fr: "Nom d'utilisateur", en: "Username", hu: "Felhasználónév" },
  "settings.security.username.placeholder": { fr: "Saisir un nom d'utilisateur", en: "Enter username", hu: "Adjon meg felhasználónevet" },
  "settings.security.password": { fr: "Mot de passe", en: "Password", hu: "Jelszó" },
  "settings.security.password.placeholderKeepCurrent": {
    fr: "Laisser vide pour conserver le mot de passe actuel",
    en: "Leave blank to keep current password",
    hu: "Hagyd üresen a jelenlegi jelszó megtartásához",
  },
  "settings.security.password.placeholderEnter": { fr: "Saisir un mot de passe", en: "Enter password", hu: "Adjon meg jelszót" },
  "settings.security.confirm": { fr: "Confirmation du mot de passe", en: "Password confirmation", hu: "Jelszó megerősítése" },
  "settings.security.confirm.placeholder": { fr: "Confirmer le mot de passe", en: "Confirm password", hu: "Erősítse meg a jelszót" },
  "settings.security.notice.credsRequired": {
    fr: "Identifiants requis : en mode Smart/Strict quand l'authentification est requise (URL publique ou proxy), renseigne un nom d'utilisateur et un mot de passe.",
    en: "Credentials required: in Smart/Strict mode when authentication is required (public URL or proxy), set username and password.",
    hu: "Belépési adatok szükségesek: intelligens/szigorú módban, ha hitelesítés kell (nyilvános URL vagy proxy), adj meg felhasználónevet és jelszót.",
  },
  "settings.security.notice.credsExisting": {
    fr: "Identifiants déjà configurés. Laisse vide pour conserver le mot de passe actuel.",
    en: "Credentials already configured. Leave blank to keep the current password.",
    hu: "A belépési adatok már be vannak állítva. Hagyd üresen a jelenlegi jelszó megtartásához.",
  },
  "settings.security.warning.smartLocalBypass": {
    fr: "Mode Smart avec identifiants configurés : les accès depuis localhost contournent l'authentification. Passez en mode Stricte pour imposer l'authentification partout.",
    en: "Smart mode with credentials configured: requests from localhost bypass authentication. Switch to Strict mode to enforce authentication everywhere.",
    hu: "Intelligens mód beállított belépéssel: a localhostról érkező kérések megkerülik a hitelesítést. Válts szigorú módra, ha mindenhol kötelező legyen.",
  },
  "settings.security.warning.downgradeOpen": {
    fr: "Passer en mode Open désactive l'authentification. Confirme la désactivation pour enregistrer.",
    en: "Switching to Open mode disables authentication. Confirm the downgrade to save.",
    hu: "A nyitott mód kikapcsolja a hitelesítést. A mentéshez erősítsd meg a kikapcsolást.",
  },
  "settings.security.error.passwordComplexityFallback": {
    fr: "Mot de passe trop simple : minimum 12 caractères avec au moins une majuscule, une minuscule, un chiffre et un caractère spécial.",
    en: "Password is too weak: minimum 12 characters with at least one uppercase, one lowercase, one digit, and one special character.",
    hu: "Túl egyszerű jelszó: legalább 12 karakter, benne legalább egy nagybetű, egy kisbetű, egy számjegy és egy speciális karakter.",
  },
  "settings.security.error.passwordAndConfirmationRequired": {
    fr: "Mot de passe et confirmation requis.",
    en: "Password and confirmation are required.",
    hu: "A jelszó és a megerősítése kötelező.",
  },
  "settings.security.error.passwordConfirmationMismatch": {
    fr: "La confirmation du mot de passe ne correspond pas.",
    en: "Password confirmation does not match.",
    hu: "A jelszó megerősítése nem egyezik.",
  },
  "settings.security.error.passwordComplexityPrefix": {
    fr: "Mot de passe trop simple : minimum",
    en: "Password is too weak: minimum",
    hu: "Túl egyszerű jelszó: legalább",
  },
  "settings.security.error.passwordComplexityWithAtLeast": {
    fr: "avec au moins",
    en: "with at least",
    hu: "és legalább",
  },
  "settings.security.error.passwordClause.upper": { fr: "une majuscule", en: "one uppercase letter", hu: "egy nagybetű" },
  "settings.security.error.passwordClause.lower": { fr: "une minuscule", en: "one lowercase letter", hu: "egy kisbetű" },
  "settings.security.error.passwordClause.digit": { fr: "un chiffre", en: "one digit", hu: "egy számjegy" },
  "settings.security.error.passwordClause.symbol": { fr: "un caractère spécial", en: "one special character", hu: "egy speciális karakter" },
  "settings.security.modal.disableAuth.title": { fr: "Désactiver l'authentification ?", en: "Disable authentication?", hu: "Kikapcsolod a hitelesítést?" },
  "settings.security.modal.disableAuth.message": {
    fr: "Passer en mode Open désactive l'authentification et supprime les identifiants.",
    en: "Switching to Open mode disables authentication and removes credentials.",
    hu: "A nyitott mód kikapcsolja a hitelesítést és törli a belépési adatokat.",
  },
  "settings.security.modal.cancel": { fr: "Annuler", en: "Cancel", hu: "Mégse" },
  "settings.security.modal.confirm": { fr: "Confirmer", en: "Confirm", hu: "Megerősítés" },
  "settings.security.subbar.info": { fr: "Infos", en: "Info", hu: "Infó" },
  "settings.security.infoModal.title": { fr: "Modes d'authentification", en: "Authentication modes", hu: "Hitelesítési módok" },
  "settings.security.infoModal.none.title": { fr: "Aucune", en: "Open", hu: "Nincs" },
  "settings.security.infoModal.none.description": {
    fr: "Aucune authentification. Tout le monde peut accéder à l'interface et à l'API.",
    en: "No authentication. Anyone can access the UI and the API.",
    hu: "Nincs hitelesítés. Bárki elérheti a felületet és az API-t.",
  },
  "settings.security.infoModal.smart.title": { fr: "Smart", en: "Smart", hu: "Intelligens" },
  "settings.security.infoModal.smart.description": {
    fr: "Authentification activée seulement si l'instance est exposée (URL publique / proxy). En local, peut rester sans authentification.",
    en: "Authentication enabled only when the instance is exposed (public URL / proxy). Locally, it may stay without authentication.",
    hu: "Hitelesítés csak akkor, ha a példány kívülről elérhető (nyilvános URL / proxy). Helyben maradhat hitelesítés nélkül.",
  },
  "settings.security.infoModal.strict.title": { fr: "Stricte", en: "Strict", hu: "Szigorú" },
  "settings.security.infoModal.strict.description": {
    fr: "Authentification toujours activée, même en local. Recommandé en production.",
    en: "Authentication always enabled, even locally. Recommended for production.",
    hu: "Mindig van hitelesítés, helyben is. Éles használatra ajánlott.",
  },
  "settings.security.infoModal.note": {
    fr: "Les identifiants existants peuvent être conservés : laisse les champs mot de passe vides pour garder le mot de passe actuel.",
    en: "Existing credentials can be kept: leave password fields empty to keep the current password.",
    hu: "A meglévő belépési adatok megtarthatók: hagyd üresen a jelszó mezőket a jelenlegi jelszó megtartásához.",
  },
  "settings.security.infoModal.close": { fr: "Fermer", en: "Close", hu: "Bezárás" },
};

export function tSecurity(key, uiLanguage = getActiveUiLanguage()) {
  const entry = SECURITY_TEXT[key];
  if (!entry) return key;
  if (String(uiLanguage || "").toLowerCase().startsWith("hu") && entry.hu) return entry.hu;
  return tr(entry.fr, entry.en, uiLanguage);
}

export function getSecurityText(uiLanguage = getActiveUiLanguage()) {
  return (key) => tSecurity(key, uiLanguage);
}
