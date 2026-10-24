import { getActiveUiLanguage } from "./locale.js";

const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"];
const ORIGINAL_ATTR_PREFIX = "data-i18n-original-";
const ELISION_PREFIXES = new Set(["l", "d", "j", "c", "n", "s", "m", "t", "qu"]);

const textOriginals = new WeakMap();
let currentLanguage = getLanguageCode(getActiveUiLanguage());
let observer = null;
let initialized = false;
let languageListener = null;

const t = (en, overrides = {}) => ({ en, ...overrides });
// t() accepts { hu: "...", ... } overrides; getLanguageCode maps "hu-HU" → "hu"

const PHRASE_TRANSLATIONS = {
  "webhook beállítás seerr-ben": t("Webhook setup in Seerr", { hu: "webhook beállítás seerr-ben" }),

  "kérte": t("Requested by", { hu: "kérte" }),

  "beérkezett": t("Received", { hu: "beérkezett" }),

  "nem egyeztetett": t("Unmatched", { hu: "nem egyeztetett" }),

  "egyeztetés futtatása": t("Run matching", { hu: "egyeztetés futtatása" }),

  "seerr kérések": t("Seerr requests", { hu: "seerr kérések" }),

  "configuration de l'application": t("Application settings", { hu: "Alkalmazás beállítások" }),
  "browser reload required": t("Browser Reload Required", { hu: "Böngésző újratöltés szükséges" }),
  "rechargement du navigateur requis": t("Browser Reload Required", { hu: "Böngésző újratöltés szükséges" }),
  "sync all": t("Sync all", { hu: "Összes szinkronizálása" }),
  "top 24h": t("Top 24h", { hu: "Top 24 óra" }),
  language: t("Language", { hu: "Nyelv" }),
  "media info language": t("Media Info Language", { hu: "Médiainformáció nyelve" }),
  "ui language": t("UI Language", { hu: "Felhasználói felület nyelve" }),
  "a propos": t("About", { hu: "Névjegy" }),
  "mise a jour": t("Update", { hu: "Frissítés" }),
  "mise a jour disponible": t("Update available", { hu: "Elérhető frissítés" }),
  "a jour": t("Up to date", { hu: "Naprakész" }),
  "version actuelle": t("Current version", { hu: "Jelenlegi verzió" }),
  "derniere release": t("Latest release", { hu: "Legújabb kiadás" }),
  "publie le": t("Published on", { hu: "Közzétéve" }),
  statut: t("Status", { hu: "Állapot" }),
  "intervalle de verification": t("Check interval", { hu: "Ellenőrzési időköz" }),
  environnement: t("Environment", { hu: "Környezet" }),
  "base de donnees": t("Database", { hu: "Adatbázis" }),
  "dossier data": t("Data folder", { hu: "Adatmappa" }),
  "chemin db": t("DB path", { hu: "Adatbázis útvonala" }),
  "espace disque": t("Disk space", { hu: "Lemezterület" }),
  emplacement: t("Location", { hu: "Helyszín" }),
  "espace libre": t("Free space", { hu: "Szabad hely" }),
  "espace total": t("Total space", { hu: "Teljes hely" }),
  utilisation: t("Usage", { hu: "Használat" }),
  "aucun volume detecte": t("No volume detected", { hu: "Nem észlelhető kötet" }),
  "requetes et synchronisations": t("Requests and synchronizations", { hu: "Kérések és szinkronizálások" }),
  "synchronisations et evenements": t("Synchronizations and events", { hu: "Szinkronizálások és események" }),
  "categories sync": t("Sync categories", { hu: "Kategóriák szinkronizálása" }),
  "temps de reponse": t("Response time", { hu: "Válaszidő" }),
  "total entrees": t("Total records", { hu: "Összes bejegyzés" }),
  "chargement de l'historique": t("Loading history...", { hu: "Előzmények betöltése..." }),
  "historique indisponible": t("History unavailable", { hu: "Előzmények nem elérhetők" }),
  "erreur chargement historique": t("History loading error", { hu: "Előzmények betöltési hiba" }),
  "erreur purge historique": t("History purge error", { hu: "Előzmények törlési hiba" }),
  "effacer l'historique": t("Clear history", { hu: "Előzmények törlése" }),
  "confirmer la suppression de l'historique": t("Confirm history deletion", { hu: "Előzmények törlésének megerősítése" }),
  "chargement des logs": t("Loading logs...", { hu: "Naplók betöltése..." }),
  "erreur chargement activite": t("Activity loading error", { hu: "Aktivitás betöltési hiba" }),
  "erreur purge logs": t("Log purge error", { hu: "Napló törlési hiba" }),
  "effacer les logs": t("Clear logs", { hu: "Naplók törlése" }),
  "confirmer la purge des logs": t("Confirm log purge", { hu: "Naplók törlésének megerősítése" }),
  "premiere page": t("First page", { hu: "Első oldal" }),
  "page precedente": t("Previous page", { hu: "Előző oldal" }),
  "page suivante": t("Next page", { hu: "Következő oldal" }),
  "derniere page": t("Last page", { hu: "Utolsó oldal" }),
  "niveau de log": t("Log level", { hu: "Napló szintje" }),
  "derniers items": t("Last items", { hu: "Legutóbbi elemek" }),
  "temps moyen": t("Average time", { hu: "Átlagos idő" }),
  resume: t("Summary", { hu: "Összefoglalás" }),
  "verifie la configuration puis lance feedarr": t("Check the configuration then launch Feedarr", { hu: "Ellenőrizze a konfigurációt, majd indítsa el a Feedarr-t" }),
  "configuration rapide en 6 etapes": t("Quick setup in 6 steps", { hu: "Gyors beállítás 6 lépésben" }),
  "configuration rapide en 7 etapes": t("Quick setup in 7 steps", { hu: "Gyors beállítás 7 lépésben" }),
  "langue par defaut": t("Default language", { hu: "Alapértelmezett nyelv" }),
  "choisis la langue par defaut de feedarr": t("Choose Feedarr default language", { hu: "Válassza ki a Feedarr alapértelmezett nyelvét" }),
  "cette etape applique la langue ui et la langue metadata par defaut": t("This step sets both UI and metadata default language", { hu: "Ez a lépés beállítja a felhasználói felület és a metaadat alapértelmezett nyelvét" }),
  "langue utilisee pour les infos media (tmdb: synopsis, titres, cast)": t("Language used for media info (TMDB: overview, titles, cast)", { hu: "Médiainformációhoz használt nyelv (TMDB: leírás, címek, szereplők)" }),
  "langue de l'interface (formatage dates/heures et preference ui)": t("UI language (date/time formatting and UI preference)", { hu: "Felhasználói felület nyelve (dátum/idő formátum és UI beállítás)" }),
  "marquer \"vu\" par defaut": t("Mark \"seen\" by default"),
  "activer vue sans poster": t("Enable no-poster view", { hu: "Poszter nélküli nézet engedélyezése" }),
  "animations de l'interface": t("Interface animations", { hu: "Felület animációk" }),
  "badge pour info": t("Badge for Info", { hu: "Info jelvény" }),
  "badge pour warn": t("Badge for Warn", { hu: "Figyelmeztetés jelvény" }),
  "badge pour error": t("Badge for Error", { hu: "Hiba jelvény" }),
  "toutes categories": t("All categories", { hu: "Összes kategória" }),
  "toutes qualites": t("All qualities", { hu: "Összes minőség" }),
  "toutes apps": t("All apps", { hu: "Összes alkalmazás" }),
  "masquer apps": t("Hide apps", { hu: "Alkalmazások elrejtése" }),
  "pas vu": t("Unseen", { hu: "Nem látott" }),
  "actions de maintenance": t("Maintenance actions", { hu: "Karbantartási műveletek" }),
  "supprimer tous les posters en cache": t("Delete all cached posters", { hu: "Az összes gyorsítótárazott poszter törlése" }),
  "supprime tous les posters telecharges localement": t("Delete all locally downloaded posters", { hu: "Az összes helyben letöltött poszter törlése" }),
  "purger logs": t("Purge logs", { hu: "Naplók ürítése" }),
  "supprime les logs d'activite (tous, historique ou logs uniquement)": t("Delete activity logs (all, history or logs only)", { hu: "Aktivitásnaplók törlése (összes, előzmény vagy csak naplók)" }),
  "optimiser la base de donnees": t("Optimize database", { hu: "Adatbázis optimalizálása" }),
  "compacte la base sqlite (vacuum) pour recuperer de l'espace": t("Compacts SQLite database (VACUUM) to free space", { hu: "SQLite adatbázis tömörítése (VACUUM) helyfoglalás csökkentéséhez" }),
  "nettoyer posters orphelins": t("Clean orphan posters", { hu: "Árva poszterek eltávolítása" }),
  "supprime les fichiers de posters non references en base": t("Delete poster files not referenced in database", { hu: "Az adatbázisban nem hivatkozott poszter fájlok törlése" }),
  "tester connectivite providers": t("Test provider connectivity", { hu: "Szolgáltató kapcsolat tesztelése" }),
  "verifie la connexion tmdb, tvmaze, fanart, igdb": t("Check TMDB, TvMaze, Fanart and IGDB connectivity", { hu: "TMDB, TvMaze, Fanart és IGDB kapcsolat ellenőrzése" }),
  "re-parser les titres": t("Re-parse titles", { hu: "Címek újraértelmezése" }),
  "recalcule les metadonnees de toutes les releases (titre, saison, resolution...)": t("Recompute metadata for all releases (title, season, resolution...)", { hu: "Összes kiadás metaadatának újraszámítása (cím, évad, felbontás...)" }),
  "detecter les doublons": t("Detect duplicates", { hu: "Duplikátumok felismerése" }),
  "identifie et supprime les releases en double par source": t("Identify and delete duplicate releases by source", { hu: "Duplikált kiadások azonosítása és törlése forrásonként" }),
  "statistiques": t("Statistics", { hu: "Statisztikák" }),
  "metrique": t("Metric", { hu: "Mérőszám" }),
  "valeur": t("Value", { hu: "Érték" }),
  "releases en base": t("Releases in database", { hu: "Kiadások az adatbázisban" }),
  "taille base de donnees": t("Database size", { hu: "Adatbázis mérete" }),
  "cache de matching": t("Matching cache", { hu: "Egyezési gyorsítótár" }),
  "entites media": t("Media entities", { hu: "Média entitások" }),
  "doublons detectes": t("Detected duplicates", { hu: "Felismert duplikátumok" }),
  "logs d'activite": t("Activity logs", { hu: "Aktivitásnaplók" }),
  "uptime serveur": t("Server uptime", { hu: "Szerver üzemidő" }),
  "par categorie": t("By category", { hu: "Kategóriánként" }),
  "confirmer la suppression": t("Confirm deletion", { hu: "Törlés megerősítése" }),
  "options de purge": t("Purge options", { hu: "Törlési lehetőségek" }),
  "tous les logs": t("All logs", { hu: "Összes napló" }),
  "historique (sync uniquement)": t("History (sync only)", { hu: "Előzmény (csak szinkronizálás)" }),
  "logs (hors sync)": t("Logs (excluding sync)", { hu: "Naplók (szinkronizálás nélkül)" }),
  "confirmer l'optimisation": t("Confirm optimization", { hu: "Optimalizálás megerősítése" }),
  "confirmer le nettoyage": t("Confirm cleanup", { hu: "Tisztítás megerősítése" }),
  "confirmer le re-parsing": t("Confirm re-parsing", { hu: "Újraértelmezés megerősítése" }),
  "confirmer la suppression des doublons": t("Confirm duplicate deletion", { hu: "Duplikátumok törlésének megerősítése" }),
  "aucune donnee": t("No data", { hu: "Nincs adat" }),
  "aucune application connectee": t("No connected application", { hu: "Nincs csatlakoztatott alkalmazás" }),
  "posters affiches": t("Displayed posters", { hu: "Megjelenített poszterek" }),
  "couverture posters": t("Poster coverage", { hu: "Poszter lefedettség" }),
  "reutilisation posters": t("Poster reuse", { hu: "Poszter újrafelhasználás" }),
  "fichiers uniques": t("unique files", { hu: "egyedi fájlok" }),
  "releases par jour": t("Releases per day", { hu: "Kiadások naponta" }),
  "releases par poster": t("releases per poster", { hu: "kiadás per poszter" }),
  "posters pour": t("posters for", { hu: "poszter ehhez:" }),
  "repartition stockage": t("Storage distribution", { hu: "Tárolás eloszlása" }),
  "taille base": t("Database size", { hu: "Adatbázis mérete" }),
  "posters locaux": t("Local posters", { hu: "Helyi poszterek" }),
  "requetes totales": t("Total queries", { hu: "Összes kérés" }),
  "echecs requetes": t("Query failures", { hu: "Kérés hibák" }),
  "echecs sync": t("Sync failures", { hu: "Szinkronizálási hibák" }),
  "releases par fournisseur": t("Releases by provider", { hu: "Kiadások szolgáltatónként" }),
  "categories par fournisseur": t("Categories by provider", { hu: "Kategóriák szolgáltatónként" }),
  "detail fournisseurs": t("Provider details", { hu: "Szolgáltató részletek" }),
  "total appels": t("Total calls", { hu: "Összes hívás" }),
  "total echecs": t("Total failures", { hu: "Összes hiba" }),
  "taux d'echec global": t("Global failure rate", { hu: "Globális hibaarány" }),
  "detail metadonnees": t("Metadata details", { hu: "Metaadat részletek" }),
  "sante des indexeurs": t("Indexer health", { hu: "Indexelők állapota" }),
  "sante des fournisseurs": t("Provider health", { hu: "Szolgáltatók állapota" }),
  "prochain sync": t("Next sync", { hu: "Következő szinkronizálás" }),
  "items dernier sync": t("Last sync items", { hu: "Legutóbbi szinkronizálás elemei" }),
  "fournisseurs indisponibles": t("Providers unavailable", { hu: "Nem elérhető szolgáltatók" }),
  "sources indisponibles": t("Sources unavailable", { hu: "Nem elérhető források" }),
  "aucune source configuree": t("No source configured", { hu: "Nincs beállított forrás" }),
  "erreur chargement statistiques": t("Statistics loading error", { hu: "Statisztikák betöltési hiba" }),
  "elements matches": t("matched items", { hu: "egyező elem" }),
  "categories par indexeur": t("Categories by indexer", { hu: "Kategóriák indexelőnként" }),
  "detail indexeurs": t("Indexer details", { hu: "Indexelő részletek" }),
  "detail providers": t("Provider details", { hu: "Szolgáltató részletek" }),
  "temps de reponse moyen": t("Average response time", { hu: "Átlagos válaszidő" }),
  "taux d'echec": t("Failure rate", { hu: "Hibaarány" }),
  "top categories": t("Top categories", { hu: "Legjobb kategóriák" }),
  "top releases (grabs)": t("Top releases (grabs)", { hu: "Legjobb kiadások (letöltések)" }),
  "distribution par taille": t("Size distribution", { hu: "Méret szerinti eloszlás" }),
  "distribution seeders": t("Seeders distribution", { hu: "Seederek eloszlása" }),
  "date d'ajout": t("Added date", { hu: "Hozzáadás dátuma" }),
  "titre original": t("Original title", { hu: "Eredeti cím" }),
  "nouveau title": t("New title", { hu: "Új cím" }),
  "nouveau titre": t("New title", { hu: "Új cím" }),
  "resultats": t("Results", { hu: "Eredmények" }),
  "selectionner une seule carte": t("Select a single card", { hu: "Csak egy kártyát válasszon ki" }),
  "poster manuel": t("Manual poster", { hu: "Manuális poszter" }),
  "filtrer par identifiant de source": t("Filter by source identifier", { hu: "Szűrés forrásazonosító szerint" }),
  "aucune sauvegarde presente": t("No backup found", { hu: "Nincs mentés" }),
  "nouvelle sauvegarde": t("New backup", { hu: "Új mentés" }),
  "creer une nouvelle sauvegarde": t("Create a new backup", { hu: "Új mentés létrehozása" }),
  "restaurer une sauvegarde": t("Restore a backup", { hu: "Mentés visszaállítása" }),
  "supprimer une sauvegarde": t("Delete a backup", { hu: "Mentés törlése" }),
  "confirmer la restauration": t("Confirm restore", { hu: "Visszaállítás megerősítése" }),
  "cette action est definitive": t("This action is permanent", { hu: "Ez a művelet végleges" }),
  "derniere synchro": t("Last sync", { hu: "Utolsó szinkronizálás" }),
  "base url": t("Base URL", { hu: "Alap URL" }),
  "laisse vide pour ne pas changer": t("Leave blank to keep current", { hu: "Hagyja üresen a megtartáshoz" }),
  "options de synchronisation": t("Synchronization options", { hu: "Szinkronizálási beállítások" }),
  "synchronisation auto": t("Automatic sync", { hu: "Automatikus szinkronizálás" }),
  "intervalle sync rss (minutes)": t("RSS sync interval (minutes)", { hu: "RSS szinkronizálási időköz (perc)" }),
  "limite rss par categorie": t("RSS limit per category", { hu: "RSS limit kategóriánként" }),
  "remplissage progressif par categorie, purge des plus anciens": t("Progressive fill per category, purge oldest items", { hu: "Fokozatos feltöltés kategóriánként, régebbiek eltávolítása" }),
  "limite rss globale (par source)": t("Global RSS limit (per source)", { hu: "Globális RSS limit (forrásonként)" }),
  "plafond global par source, purge des plus anciens": t("Global cap per source, purge oldest items", { hu: "Globális felső határ forrásonként, régebbiek eltávolítása" }),
  "choisir un fournisseur...": t("Choose a provider...", { hu: "Válasszon szolgáltatót..." }),
  "choisir un indexeur...": t("Choose an indexer...", { hu: "Válasszon indexelőt..." }),
  "ajouter manuellement...": t("Add manually...", { hu: "Manuális hozzáadás..." }),
  "tester categories": t("Test categories", { hu: "Kategóriák tesztelése" }),
  "masquer options avancees": t("Hide advanced options", { hu: "Speciális beállítások elrejtése" }),
  "test reussi": t("Test successful", { hu: "Teszt sikeres" }),
  "suivant": t("Next", { hu: "Következő" }),
  "tous les indexeurs sont deja ajoutes": t("All indexers are already added", { hu: "Minden indexelő már hozzá van adva" }),
  "pas besoin de cle sauf abonnement": t("No key needed unless you have a subscription", { hu: "Nincs szükség kulcsra előfizetés nélkül" }),
  "provider invalide": t("Invalid provider", { hu: "Érvénytelen szolgáltató" }),
  "client id et client secret requis": t("Client ID and Client Secret required", { hu: "Ügyfél-azonosító és ügyféltitkos szükséges" }),
  "cle api requise": t("API key required", { hu: "API kulcs szükséges" }),
  "connexion reussie ! vous pouvez enregistrer": t("Connection successful! You can save", { hu: "Kapcsolat sikeres! Menthet." }),
  "configuration enregistree. ajoute les indexeurs manuellement a l'etape suivante": t("Configuration saved. Add indexers manually at the next step", { hu: "Konfiguráció mentve. Adja hozzá az indexelőket manuálisan a következő lépésben." }),
  "cles deja enregistrees": t("Keys already saved", { hu: "Kulcsok már mentve" }),
  "voir sur tmdb / igdb": t("View on TMDB / IGDB", { hu: "Megtekintés TMDB / IGDB-n" }),
  "ajouter un fournisseur": t("Add a provider", { hu: "Szolgáltató hozzáadása" }),
  "ajouter une source": t("Add a source", { hu: "Forrás hozzáadása" }),
  "ajouter une application": t("Add an application", { hu: "Alkalmazás hozzáadása" }),
  "supprimer l'application": t("Delete application", { hu: "Alkalmazás törlése" }),
  "options applications": t("Application options", { hu: "Alkalmazás beállítások" }),
  "aucune application configuree": t("No configured application", { hu: "Nincs beállított alkalmazás" }),
  "mode d'envoi": t("Delivery mode", { hu: "Küldési mód" }),
  "integration active": t("Active integration", { hu: "Aktív integráció" }),
  "a sauvegarder": t("To save", { hu: "Mentendő" }),
  "etat de synchronisation": t("Synchronization status", { hu: "Szinkronizálás állapota" }),
  "dernier sync": t("Last sync", { hu: "Utolsó szinkronizálás" }),
  "nom (optionnel)": t("Name (optional)", { hu: "Név (opcionális)" }),
  "entrez la cle api": t("Enter API key", { hu: "Adja meg az API kulcsot" }),
  "entrez le client id": t("Enter Client ID", { hu: "Adja meg az ügyfél-azonosítót" }),
  "entrez le client secret": t("Enter Client Secret", { hu: "Adja meg az ügyféltitkost" }),
  "test en cours": t("Test in progress", { hu: "Teszt folyamatban" }),
  "confirmer la desactivation": t("Confirm disable", { hu: "Letiltás megerősítése" }),
  "confirmer l'action": t("Confirm action", { hu: "Művelet megerősítése" }),
  "activez d'abord le provider": t("Enable the provider first", { hu: "Először engedélyezze a szolgáltatót" }),
  "cette action est irreversible": t("This action is irreversible", { hu: "Ez a művelet visszavonhatatlan" }),
  "cette action va desactiver le provider et supprimer la cle api associee": t("This action will disable the provider and remove the associated API key", { hu: "Ez a művelet letiltja a szolgáltatót és törli a kapcsolódó API kulcsot" }),
  "cette action va desactiver le provider (la cle api est conservee)": t("This action will disable the provider (API key is kept)", { hu: "Ez a művelet letiltja a szolgáltatót (az API kulcs megmarad)" }),
  "cette action va activer le provider": t("This action will enable the provider", { hu: "Ez a művelet engedélyezi a szolgáltatót" }),
  "chargement de la configuration": t("Loading configuration", { hu: "Konfiguráció betöltése" }),
  "-- selectionner --": t("-- Select --", { hu: "-- Válasszon --" }),
  "id du profil": t("Profile ID", { hu: "Profil azonosítója" }),
  "type de serie": t("Series type", { hu: "Sorozat típusa" }),
  "mode de surveillance": t("Monitoring mode", { hu: "Figyelési mód" }),
  "tous les episodes": t("All episodes", { hu: "Összes epizód" }),
  "futurs episodes": t("Future episodes", { hu: "Jövőbeli epizódok" }),
  "episodes manquants": t("Missing episodes", { hu: "Hiányzó epizódok" }),
  "episodes existants": t("Existing episodes", { hu: "Meglévő epizódok" }),
  "premiere saison": t("First season", { hu: "Első évad" }),
  "dossiers par saison": t("Season folders", { hu: "Évadmappák" }),
  "rechercher episodes manquants": t("Search missing episodes", { hu: "Hiányzó epizódok keresése" }),
  "rechercher cutoff non atteint": t("Search unmet cutoff", { hu: "Nem elért minőséghatár keresése" }),
  "disponibilite minimale": t("Minimum availability", { hu: "Minimális elérhetőség" }),
  "annonce": t("Announced", { hu: "Bejelentett" }),
  "en salle": t("In theaters", { hu: "Moziban" }),
  "sorti": t("Released", { hu: "Megjelent" }),
  "rechercher le film a l'ajout": t("Search for movie on add", { hu: "Film keresése hozzáadáskor" }),
  "cette action va supprimer tous les posters telecharges localement": t("This action will delete all locally downloaded posters", { hu: "Ez a művelet törli az összes helyben letöltött posztert" }),
  "elle ne nettoie pas uniquement les orphelins": t("This does not only clean orphan files", { hu: "Ez nem csak az árva fájlokat törli" }),
  "ils seront re-telecharges automatiquement lors du prochain affichage": t("They will be downloaded again automatically on next display", { hu: "Automatikusan újra letöltődnek a következő megjelenítéskor" }),
  "cette action execute un vacuum sqlite pour compacter la base de donnees et recuperer l'espace disque": t("This runs SQLite VACUUM to compact the database and reclaim disk space", { hu: "Ez SQLite VACUUM műveletet hajt végre az adatbázis tömörítéséhez és a lemezterület visszanyeréséhez" }),
  "l'operation peut prendre quelques secondes": t("This operation may take a few seconds", { hu: "A művelet néhány másodpercet vehet igénybe" }),
  "cette action va scanner le dossier de posters et supprimer les fichiers qui ne sont plus references par aucune release en base": t("This action will scan the posters folder and delete files no longer referenced by any release", { hu: "Ez átvizsgálja a poszter mappát és törli az adatbázisban nem hivatkozott fájlokat" }),
  "cette action va supprimer l'application": t("This action will delete application", { hu: "Ez a művelet törli az alkalmazást" }),
  "cette action va re-parser tous les titres de releases pour recalculer les metadonnees (titre nettoye, saison, episode, resolution, codec, etc)": t("This action will re-parse all release titles to recompute metadata (clean title, season, episode, resolution, codec, etc.)", { hu: "Ez az összes kiadási cím újraértelmezésével újraszámítja a metaadatokat (tisztított cím, évad, epizód, felbontás, kodek stb.)" }),
  "utile apres une mise a jour du parser": t("Useful after a parser update", { hu: "Hasznos az értelmező frissítése után" }),
  "l'operation peut prendre un moment selon le nombre de releases": t("This operation may take a while depending on release count", { hu: "A művelet eltarthat egy ideig a kiadások számától függően" }),
  "pour chaque groupe de doublons, seule la release la plus recente sera conservee": t("For each duplicate group, only the most recent release is kept", { hu: "Minden duplikált csoportból csak a legújabb kiadás marad meg" }),
  "cette action cree une archive zip locale contenant la base de donnees et les metadonnees de configuration (sans exposer les secrets en clair dans `config.json`)": t("This action creates a local ZIP archive containing the database and configuration metadata (without exposing plain secrets in `config.json`)", { hu: "Ez a művelet helyi ZIP archívumot hoz létre az adatbázissal és a konfigurációs metaadatokkal (a titkokat nem tárolja egyszerű szövegként a `config.json`-ban)" }),
  "un redemarrage de l'application sera requis apres restauration": t("An application restart is required after restore", { hu: "A visszaállítás után az alkalmazás újraindítása szükséges" }),
  "aucune categorie disponible": t("No category available", { hu: "Nincs elérhető kategória" }),
  "laisse vide pour utiliser la cle du fournisseur": t("Leave blank to use provider API key", { hu: "Hagyja üresen a szolgáltató kulcsának használatához" }),
  "colle l'url copy torznab feed": t("Paste the Copy Torznab Feed URL", { hu: "Illessze be a Torznab feed URL-t" }),
  "depuis jackett/prowlarr, utilise \"copy torznab feed\", puis colle l'url complete": t("From Jackett/Prowlarr, use \"Copy Torznab Feed\", then paste the full URL"),
  "categories retenues": t("Selected categories", { hu: "Kiválasztott kategóriák" }),
  "nouvel indexeur": t("New indexer", { hu: "Új indexelő" }),
  "nom de l'indexeur": t("Indexer name", { hu: "Indexelő neve" }),
  "plus vieux que (jours)": t("Older than (days)", { hu: "Régebbi mint (napok)" }),
  "testez d'abord la connexion avant d'enregistrer": t("Test the connection first before saving", { hu: "Tesztelje a kapcsolatot mentés előtt" }),
  "toutes les applications sont deja ajoutees": t("All applications are already added", { hu: "Minden alkalmazás már hozzá van adva" }),
};

const WORD_TRANSLATIONS = {
  bibliotheque: t("Library", { hu: "Könyvtár" }),
  parametres: t("Settings", { hu: "Beállítások" }),
  fournisseur: t("Provider", { hu: "Szolgáltató" }),
  fournisseurs: t("Providers", { hu: "Szolgáltatók" }),
  provider: t("Provider", { hu: "Szolgáltató" }),
  providers: t("Providers", { hu: "Szolgáltatók" }),
  indexeur: t("Indexer", { hu: "Indexelő" }),
  indexeurs: t("Indexers", { hu: "Indexelők" }),
  indexer: t("Indexer", { hu: "Indexelő" }),
  applications: t("Applications", { hu: "Alkalmazások" }),
  application: t("Application", { hu: "Alkalmazás" }),
  rss: t("RSS", { hu: "RSS" }),
  maintenance: t("Maintenance", { hu: "Karbantartás" }),
  sauvegarde: t("Backup", { hu: "Mentés" }),
  sauvegardes: t("Backups", { hu: "Mentések" }),
  systeme: t("System", { hu: "Rendszer" }),
  historique: t("History", { hu: "Előzmény" }),
  logs: t("Logs", { hu: "Naplók" }),
  configuration: t("Configuration", { hu: "Konfiguráció" }),
  charge: t("Loading", { hu: "Betöltés" }),
  chargement: t("Loading", { hu: "Betöltés" }),
  erreur: t("Error", { hu: "Hiba" }),
  rafraichir: t("Refresh", { hu: "Frissítés" }),
  effacer: t("Clear", { hu: "Törlés" }),
  sauver: t("Save", { hu: "Mentés" }),
  ajouter: t("Add", { hu: "Hozzáadás" }),
  ajoute: t("Added", { hu: "Hozzáadva" }),
  ajoutee: t("Added", { hu: "Hozzáadva" }),
  ajoutees: t("Added", { hu: "Hozzáadva" }),
  options: t("Options", { hu: "Beállítások" }),
  enregistrer: t("Save", { hu: "Mentés" }),
  enregistre: t("Saved", { hu: "Mentve" }),
  enregistree: t("Saved", { hu: "Mentve" }),
  enregistrees: t("Saved", { hu: "Mentve" }),
  enregistrement: t("Saving", { hu: "Mentés" }),
  sauvegarder: t("Save", { hu: "Mentés" }),
  annuler: t("Cancel", { hu: "Mégse" }),
  supprimer: t("Delete", { hu: "Törlés" }),
  suppression: t("Deletion", { hu: "Törlés" }),
  desactiver: t("Disable", { hu: "Letiltás" }),
  desactivation: t("Disable", { hu: "Letiltás" }),
  activer: t("Enable", { hu: "Engedélyezés" }),
  actif: t("Active", { hu: "Aktív" }),
  actifs: t("Active", { hu: "Aktív" }),
  active: t("Active", { hu: "Aktív" }),
  actives: t("Active", { hu: "Aktív" }),
  desactive: t("Disabled", { hu: "Letiltva" }),
  desactivee: t("Disabled", { hu: "Letiltva" }),
  desactivees: t("Disabled", { hu: "Letiltva" }),
  inactif: t("Inactive", { hu: "Inaktív" }),
  irreversible: t("irreversible", { hu: "visszavonhatatlan" }),
  modifier: t("Edit", { hu: "Szerkesztés" }),
  editer: t("Edit", { hu: "Szerkesztés" }),
  derniere: t("Last", { hu: "Utolsó" }),
  synchro: t("sync", { hu: "szinkron" }),
  metadonnees: t("Metadata", { hu: "Metaadatok" }),
  statut: t("Status", { hu: "Állapot" }),
  environnement: t("Environment", { hu: "Környezet" }),
  dossier: t("Folder", { hu: "Mappa" }),
  chemin: t("Path", { hu: "Útvonal" }),
  db: t("DB", { hu: "AB" }),
  espace: t("Space", { hu: "Hely" }),
  libre: t("Free", { hu: "Szabad" }),
  emplacement: t("Location", { hu: "Helyszín" }),
  utilisation: t("Usage", { hu: "Használat" }),
  fichier: t("file", { hu: "fájl" }),
  fichiers: t("files", { hu: "fájlok" }),
  unique: t("unique", { hu: "egyedi" }),
  uniques: t("unique", { hu: "egyedi" }),
  prochain: t("Next", { hu: "Következő" }),
  manuel: t("Manual", { hu: "Manuális" }),
  verification: t("Check", { hu: "Ellenőrzés" }),
  actuelle: t("Current", { hu: "Jelenlegi" }),
  actuel: t("Current", { hu: "Jelenlegi" }),
  requete: t("query", { hu: "kérés" }),
  requetes: t("queries", { hu: "kérések" }),
  elements: t("items", { hu: "elemek" }),
  matches: t("matched", { hu: "egyező" }),
  sante: t("Health", { hu: "Állapot" }),
  securite: t("Security", { hu: "Biztonság" }),
  theme: t("Theme", { hu: "Téma" }),
  apparence: t("Appearance", { hu: "Megjelenés" }),
  clair: t("Light", { hu: "Világos" }),
  sombre: t("Dark", { hu: "Sötét" }),
  langue: t("Language", { hu: "Nyelv" }),
  filtre: t("Filter", { hu: "Szűrő" }),
  date: t("Date", { hu: "Dátum" }),
  source: t("Source", { hu: "Forrás" }),
  sources: t("Sources", { hu: "Források" }),
  categorie: t("Category", { hu: "Kategória" }),
  categories: t("Categories", { hu: "Kategóriák" }),
  qualite: t("Quality", { hu: "Minőség" }),
  toutes: t("All", { hu: "Összes" }),
  tous: t("All", { hu: "Összes" }),
  vue: t("View", { hu: "Nézet" }),
  liste: t("List", { hu: "Lista" }),
  tri: t("Sort", { hu: "Rendezés" }),
  limite: t("Limit", { hu: "Limit" }),
  test: t("Test", { hu: "Teszt" }),
  tester: t("Test", { hu: "Tesztelés" }),
  executer: t("Run", { hu: "Futtatás" }),
  analyser: t("Analyze", { hu: "Elemzés" }),
  analyse: t("Analyzing", { hu: "Elemzés folyamatban" }),
  niveau: t("Level", { hu: "Szint" }),
  avertissement: t("Warning", { hu: "Figyelmeztetés" }),
  nom: t("Name", { hu: "Név" }),
  couleur: t("Color", { hu: "Szín" }),
  connexion: t("Connection", { hu: "Kapcsolat" }),
  connectivite: t("connectivity", { hu: "kapcsolat" }),
  reussie: t("successful", { hu: "sikeres" }),
  retro: t("Retro", { hu: "Retró" }),
  fetch: t("Fetch", { hu: "Lekérés" }),
  arreter: t("Stop", { hu: "Leállítás" }),
  demarrer: t("Start", { hu: "Indítás" }),
  lancer: t("Launch", { hu: "Indítás" }),
  lancement: t("Launching", { hu: "Indítás" }),
  restauration: t("Restore", { hu: "Visszaállítás" }),
  telechargement: t("Download", { hu: "Letöltés" }),
  telecharger: t("Download", { hu: "Letöltés" }),
  operation: t("Operation", { hu: "Művelet" }),
  cours: t("in progress", { hu: "folyamatban" }),
  redemarrage: t("Restart", { hu: "Újraindítás" }),
  requis: t("required", { hu: "szükséges" }),
  apres: t("after", { hu: "után" }),
  teste: t("tested", { hu: "tesztelve" }),
  echec: t("failed", { hu: "sikertelen" }),
  echecs: t("failures", { hu: "hibák" }),
  succes: t("success", { hu: "siker" }),
  synchronisation: t("Synchronization", { hu: "Szinkronizálás" }),
  synchronisations: t("Synchronizations", { hu: "Szinkronizálások" }),
  evenements: t("Events", { hu: "Események" }),
  automatique: t("Automatic", { hu: "Automatikus" }),
  intervalle: t("Interval", { hu: "Időköz" }),
  minutes: t("minutes", { hu: "perc" }),
  etat: t("Status", { hu: "Állapot" }),
  jamais: t("Never", { hu: "Soha" }),
  dernier: t("Last", { hu: "Utolsó" }),
  derniers: t("Last", { hu: "Utolsó" }),
  temps: t("Time", { hu: "Idő" }),
  items: t("items", { hu: "elemek" }),
  demandes: t("requests", { hu: "kérések" }),
  avancees: t("advanced", { hu: "speciális" }),
  mode: t("Mode", { hu: "Mód" }),
  general: t("General", { hu: "Általános" }),
  statistiques: t("Statistics", { hu: "Statisztikák" }),
  stockage: t("Storage", { hu: "Tárolás" }),
  wizard: t("wizard", { hu: "varázsló" }),
  aucun: t("No", { hu: "Nincs" }),
  aucune: t("No", { hu: "Nincs" }),
  non: t("Not", { hu: "Nem" }),
  configure: t("Configured", { hu: "Konfigurálva" }),
  configuree: t("Configured", { hu: "Konfigurálva" }),
  configurees: t("Configured", { hu: "Konfigurálva" }),
  configures: t("Configured", { hu: "Konfigurálva" }),
  configurer: t("Configure", { hu: "Konfigurálás" }),
  choisir: t("Choose", { hu: "Választás" }),
  choisis: t("Choose", { hu: "Válasszon" }),
  valider: t("Validate", { hu: "Érvényesítés" }),
  valide: t("Valid", { hu: "Érvényes" }),
  invalide: t("Invalid", { hu: "Érvénytelen" }),
  verifier: t("Check", { hu: "Ellenőrzés" }),
  verifie: t("Check", { hu: "Ellenőrzés" }),
  impossible: t("Unable", { hu: "Nem lehetséges" }),
  resume: t("Summary", { hu: "Összefoglalás" }),
  poster: t("Poster", { hu: "Poszter" }),
  posters: t("Posters", { hu: "Poszterek" }),
  locaux: t("Local", { hu: "Helyi" }),
  local: t("Local", { hu: "Helyi" }),
  manquant: t("Missing", { hu: "Hiányzó" }),
  manquants: t("Missing", { hu: "Hiányzó" }),
  recherche: t("Search", { hu: "Keresés" }),
  pourcentage: t("Percentage", { hu: "Százalék" }),
  matching: t("Matching", { hu: "Egyeztetés" }),
  detecter: t("Detect", { hu: "Felismerés" }),
  detectes: t("Detected", { hu: "Felismerve" }),
  doublon: t("Duplicate", { hu: "Duplikátum" }),
  doublons: t("Duplicates", { hu: "Duplikátumok" }),
  groupe: t("Group", { hu: "Csoport" }),
  groupes: t("Groups", { hu: "Csoportok" }),
  purge: t("Purge", { hu: "Ürítés" }),
  purger: t("Purge", { hu: "Ürítés" }),
  nettoyer: t("Clean", { hu: "Tisztítás" }),
  nettoyage: t("Cleanup", { hu: "Tisztítás" }),
  optimiser: t("Optimize", { hu: "Optimalizálás" }),
  optimisation: t("Optimization", { hu: "Optimalizálás" }),
  base: t("Database", { hu: "Adatbázis" }),
  donnees: t("Data", { hu: "Adatok" }),
  metrique: t("Metric", { hu: "Mérőszám" }),
  valeur: t("Value", { hu: "Érték" }),
  entites: t("Entities", { hu: "Entitások" }),
  media: t("Media", { hu: "Média" }),
  activite: t("Activity", { hu: "Aktivitás" }),
  taille: t("Size", { hu: "Méret" }),
  serveur: t("Server", { hu: "Szerver" }),
  uptime: t("Uptime", { hu: "Üzemidő" }),
  reparser: t("Re-parse", { hu: "Újraértelmezés" }),
  "re-parsing": t("Re-parsing", { hu: "Újraértelmezés" }),
  titres: t("Titles", { hu: "Címek" }),
  titre: t("Title", { hu: "Cím" }),
  annee: t("Year", { hu: "Év" }),
  nouveau: t("New", { hu: "Új" }),
  original: t("Original", { hu: "Eredeti" }),
  saison: t("Season", { hu: "Évad" }),
  episode: t("Episode", { hu: "Epizód" }),
  episodes: t("Episodes", { hu: "Epizódok" }),
  resolution: t("Resolution", { hu: "Felbontás" }),
  entrees: t("entries", { hu: "bejegyzések" }),
  entree: t("entry", { hu: "bejegyzés" }),
  jour: t("day", { hu: "nap" }),
  jours: t("days", { hu: "napok" }),
  top: t("Top", { hu: "Top" }),
  telecharge: t("Downloaded", { hu: "Letöltve" }),
  telecharges: t("Downloaded", { hu: "Letöltve" }),
  telechargee: t("Downloaded", { hu: "Letöltve" }),
  recent: t("Recent", { hu: "Legújabb" }),
  recents: t("Recent", { hu: "Legújabb" }),
  plus: t("most", { hu: "legtöbb" }),
  seedes: t("seeded", { hu: "seedelve" }),
  api: t("API", { hu: "API" }),
  cle: t("Key", { hu: "Kulcs" }),
  client: t("Client", { hu: "Ügyfél" }),
  secret: t("Secret", { hu: "Titkos" }),
  envoi: t("Delivery", { hu: "Küldés" }),
  integration: t("Integration", { hu: "Integráció" }),
  associee: t("associated", { hu: "kapcsolódó" }),
  conservee: t("kept", { hu: "megőrzött" }),
  "d'abord": t("first", { hu: "először" }),
  entrez: t("Enter", { hu: "Adja meg" }),
  laisse: t("Leave", { hu: "Hagyja" }),
  vide: t("blank", { hu: "üresen" }),
  changer: t("change", { hu: "változtatás" }),
  fermer: t("Close", { hu: "Bezárás" }),
  retour: t("Back", { hu: "Vissza" }),
  optionnel: t("Optional", { hu: "Opcionális" }),
  afficher: t("Show", { hu: "Megjelenítés" }),
  masquer: t("Hide", { hu: "Elrejtés" }),
  confirmer: t("Confirm", { hu: "Megerősítés" }),
  cette: t("This", { hu: "Ez" }),
  va: t("will", { hu: "fogja" }),
  action: t("action", { hu: "művelet" }),
  definitive: t("permanent", { hu: "végleges" }),
  temporairement: t("temporarily", { hu: "átmenetileg" }),
  verrouillees: t("locked", { hu: "zárolt" }),
  presentes: t("present", { hu: "jelen" }),
  presente: t("present", { hu: "jelen" }),
  nouvelle: t("New", { hu: "Új" }),
  creer: t("Create", { hu: "Létrehozás" }),
  creee: t("Created", { hu: "Létrehozva" }),
  cree: t("Created", { hu: "Létrehozva" }),
  terminee: t("Completed", { hu: "Befejezve" }),
  termine: t("Completed", { hu: "Befejezve" }),
  restaurer: t("Restore", { hu: "Visszaállítás" }),
  vu: t("Seen", { hu: "Látott" }),
  pas: t("Not", { hu: "Nem" }),
  renommer: t("Rename", { hu: "Átnevezés" }),
  retirer: t("Remove", { hu: "Eltávolítás" }),
  selectionner: t("Select", { hu: "Kiválasztás" }),
  selectionne: t("Selected", { hu: "Kiválasztva" }),
  selectionnee: t("Selected", { hu: "Kiválasztva" }),
  selectionnees: t("Selected", { hu: "Kiválasztva" }),
  carte: t("Card", { hu: "Kártya" }),
  cartes: t("Cards", { hu: "Kártyák" }),
  details: t("Details", { hu: "Részletek" }),
  detail: t("Detail", { hu: "Részlet" }),
  precedente: t("Previous", { hu: "Előző" }),
  suivante: t("Next", { hu: "Következő" }),
  premiere: t("First", { hu: "Első" }),
  total: t("Total", { hu: "Összesen" }),
  avec: t("With", { hu: "Val/vel" }),
  sans: t("Without", { hu: "Nélkül" }),
  global: t("Global", { hu: "Globális" }),
  taux: t("Rate", { hu: "Arány" }),
  moyen: t("Average", { hu: "Átlagos" }),
  reponse: t("Response", { hu: "Válasz" }),
  appels: t("Calls", { hu: "Hívások" }),
  queries: t("Queries", { hu: "Lekérdezések" }),
  grabs: t("Grabs", { hu: "Letöltések" }),
  distribution: t("Distribution", { hu: "Eloszlás" }),
  seeders: t("Seeders", { hu: "Seederek" }),
};

function getLanguageCode(uiLanguage) {
  const raw = String(uiLanguage || "fr-FR").trim().toLowerCase();
  if (raw.startsWith("fr")) return "fr";
  if (raw.startsWith("en")) return "en";
  if (raw.startsWith("hu")) return "hu";
  return "en";
}

function normalizeTextKey(value) {
  return String(value || "")
    .replace(/[’]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "")
    .toLowerCase();
}

function normalizeToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase();
}

function toCasePattern(source, translated) {
  if (!source || !translated) return translated;
  if (source.toUpperCase() === source) return translated.toUpperCase();
  if (source[0] && source[0].toUpperCase() === source[0]) {
    return translated[0] ? translated[0].toUpperCase() + translated.slice(1) : translated;
  }
  return translated;
}

function getPhraseTranslation(text, language) {
  const key = normalizeTextKey(text);
  const phrase = PHRASE_TRANSLATIONS[key];
  if (!phrase) return null;
  return phrase[language] || phrase.en || null;
}

function getWordTranslation(token, language) {
  const key = normalizeToken(token);
  const entry = WORD_TRANSLATIONS[key];
  if (entry) {
    const translated = entry[language] || entry.en;
    if (translated) return toCasePattern(token, translated);
  }

  const apostropheIndex = token.search(/['’]/);
  if (apostropheIndex > 0 && apostropheIndex < token.length - 1) {
    const prefix = normalizeToken(token.slice(0, apostropheIndex));
    if (ELISION_PREFIXES.has(prefix)) {
      const rest = token.slice(apostropheIndex + 1);
      const restTranslated = getWordTranslation(rest, language);
      if (restTranslated) return toCasePattern(token, restTranslated);
    }
  }

  return null;
}

function applyPatternTranslation(text, language) {
  if (!text) return null;
  const normalized = normalizeTextKey(text);

  const addToMatch = normalized.match(/^ajouter\s+[a]\s+(.+)$/);
  if (addToMatch) {
    const target = text.replace(/^Ajouter\s+[àa]\s+/i, "");
    return language === "en" ? `Add to ${target}` : `Add to ${target}`;
  }

  const fallbackMatch = normalized.match(/^non trouve\s*-\s*ouvrir\s+(.+)$/);
  if (fallbackMatch) {
    const target = text.replace(/^.*-\s*Ouvrir\s+/i, "");
    return language === "en" ? `Not found - Open ${target}` : `Not found - Open ${target}`;
  }

  const deleteLinkedMatch = normalized.match(
    /^supprimer aussi (\d+) indexeur(?:s)? lie(?:s)? \(desactivation automatique\)$/
  );
  if (deleteLinkedMatch) {
    const count = Number(deleteLinkedMatch[1] || 0);
    const suffix = count > 1 ? "s" : "";
    return language === "en"
      ? `Also delete ${count} linked indexer${suffix} (automatic disable).`
      : `Also delete ${count} linked indexer${suffix} (automatic disable).`;
  }

  const lastSyncMatch = normalized.match(/^derniere synchro\s*:\s*(.+)$/);
  if (lastSyncMatch) {
    const target = text.replace(/^Derni(?:e|è)re synchro\s*:\s*/i, "");
    return language === "en" ? `Last sync: ${target}` : `Last sync: ${target}`;
  }

  const deleteDuplicateReleasesMatch = normalized.match(/^cette action va supprimer (\d+) releases en double$/);
  if (deleteDuplicateReleasesMatch) {
    const count = Number(deleteDuplicateReleasesMatch[1] || 0);
    return language === "en"
      ? `This action will delete ${count} duplicate releases.`
      : `This action will delete ${count} duplicate releases.`;
  }

  const selectedCategoriesMatch = normalized.match(/^categories retenues\s*\((\d+)\s*\/\s*(\d+)\)$/);
  if (selectedCategoriesMatch) {
    return language === "en"
      ? `Selected categories (${selectedCategoriesMatch[1]}/${selectedCategoriesMatch[2]})`
      : `Selected categories (${selectedCategoriesMatch[1]}/${selectedCategoriesMatch[2]})`;
  }

  if (/^cette action remplace la base actuelle par la sauvegarde\s*:?\s*$/.test(normalized)) {
    return language === "en"
      ? "This action replaces the current database with backup:"
      : "This action replaces the current database with backup:";
  }

  if (/^cette action va supprimer la sauvegarde\s*:?\s*$/.test(normalized)) {
    return language === "en"
      ? "This action will delete backup:"
      : "This action will delete backup:";
  }

  if (/^plus vieux que \(jours\)/.test(normalized)) {
    return language === "en"
      ? "Older than (days)"
      : "Older than (days)";
  }

  const deletedEntriesMatch = normalized.match(/^(\d+)\s+entrees supprimees$/);
  if (deletedEntriesMatch) {
    const count = Number(deletedEntriesMatch[1] || 0);
    return language === "en" ? `${count} entries deleted` : `${count} entries deleted`;
  }

  const deletedScannedFreedMatch = normalized.match(/^(\d+)\s+supprimes?\s*\/\s*(\d+)\s+scannes?\s*\((.+)\s+liberes\)$/);
  if (deletedScannedFreedMatch) {
    const deleted = deletedScannedFreedMatch[1];
    const scanned = deletedScannedFreedMatch[2];
    const freed = deletedScannedFreedMatch[3];
    return language === "en"
      ? `${deleted} deleted / ${scanned} scanned (${freed} freed)`
      : `${deleted} deleted / ${scanned} scanned (${freed} freed)`;
  }

  const groupsDuplicatesMatch = normalized.match(/^(\d+)\s+groupes,\s*(\d+)\s+doublons detectes$/);
  if (groupsDuplicatesMatch) {
    const groups = groupsDuplicatesMatch[1];
    const duplicates = groupsDuplicatesMatch[2];
    return language === "en"
      ? `${groups} groups, ${duplicates} duplicates detected`
      : `${groups} groups, ${duplicates} duplicates detected`;
  }

  const deletedDuplicatesMatch = normalized.match(/^(\d+)\s+doublons supprimes$/);
  if (deletedDuplicatesMatch) {
    const count = deletedDuplicatesMatch[1];
    return language === "en"
      ? `${count} duplicates deleted`
      : `${count} duplicates deleted`;
  }

  return null;
}

function translateTextContent(text, language) {
  if (language === "fr") return text;

  const raw = String(text || "");
  if (!raw.trim()) return raw;

  const leading = raw.match(/^\s*/)?.[0] || "";
  const trailing = raw.match(/\s*$/)?.[0] || "";
  const core = raw.slice(leading.length, raw.length - trailing.length);

  const punctuationSuffix = core.match(/[.!?]+$/)?.[0] || "";
  const coreWithoutPunctuation = punctuationSuffix ? core.slice(0, -punctuationSuffix.length) : core;

  const patternTranslation = applyPatternTranslation(coreWithoutPunctuation, language);
  if (patternTranslation) return `${leading}${patternTranslation}${punctuationSuffix}${trailing}`;

  const phrase = getPhraseTranslation(coreWithoutPunctuation, language);
  if (phrase) return `${leading}${phrase}${punctuationSuffix}${trailing}`;

  let changed = false;
  const translatedCore = core.replace(/([A-Za-zÀ-ÿ0-9'’_-]+)/g, (word) => {
    const translated = getWordTranslation(word, language);
    if (!translated) return word;
    if (translated !== word) changed = true;
    return translated;
  });

  return changed ? `${leading}${translatedCore}${trailing}` : raw;
}

function shouldSkipElement(element) {
  if (!element) return true;
  const tag = element.tagName?.toLowerCase();
  if (!tag) return true;
  if (tag === "script" || tag === "style" || tag === "code" || tag === "pre") return true;
  if (element.closest("[data-no-ui-translate='1']")) return true;
  return false;
}

function translateTextNode(node) {
  const parent = node.parentElement;
  if (!parent || shouldSkipElement(parent)) return;

  const currentValue = node.nodeValue;
  if (currentValue == null) return;

  let original = textOriginals.has(node) ? textOriginals.get(node) : currentValue;
  if (!textOriginals.has(node)) {
    textOriginals.set(node, original);
  } else {
    const expectedCurrent = translateTextContent(original, currentLanguage);
    if (currentValue !== expectedCurrent) {
      original = currentValue;
      textOriginals.set(node, original);
    }
  }

  const translated = translateTextContent(original, currentLanguage);
  if (translated !== currentValue) node.nodeValue = translated;
}

function attrStorageKey(attrName) {
  return `${ORIGINAL_ATTR_PREFIX}${attrName}`;
}

function translateElementAttributes(element) {
  if (!element || shouldSkipElement(element)) return;

  TRANSLATABLE_ATTRIBUTES.forEach((attr) => {
    const currentValue = element.getAttribute(attr);
    if (currentValue == null) return;

    const storageKey = attrStorageKey(attr);
    let original = element.getAttribute(storageKey) ?? currentValue;
    if (!element.hasAttribute(storageKey)) {
      element.setAttribute(storageKey, original);
    } else {
      const expectedCurrent = translateTextContent(original, currentLanguage);
      if (currentValue !== expectedCurrent) {
        original = currentValue;
        element.setAttribute(storageKey, original);
      }
    }

    const translated = translateTextContent(original, currentLanguage);
    if (translated !== currentValue) {
      element.setAttribute(attr, translated);
    }
  });
}

function translateSubtree(root) {
  if (!root) return;

  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root);
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const element = root;
  if (shouldSkipElement(element)) return;

  translateElementAttributes(element);

  for (const child of element.childNodes) {
    translateSubtree(child);
  }
}

function handleMutations(mutations) {
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      translateSubtree(mutation.target);
      continue;
    }

    if (mutation.type === "attributes") {
      translateSubtree(mutation.target);
      continue;
    }

    mutation.addedNodes.forEach((node) => translateSubtree(node));
  }
}

function refreshEntireDocument() {
  if (typeof document === "undefined" || !document.body) return;
  translateSubtree(document.body);
}

function onLanguageChanged(event) {
  const language = event?.detail?.language;
  currentLanguage = getLanguageCode(language || getActiveUiLanguage());
  refreshEntireDocument();
}

export function initRuntimeTranslation() {
  if (initialized) {
    refreshEntireDocument();
    return;
  }

  if (typeof window === "undefined" || typeof document === "undefined") return;

  currentLanguage = getLanguageCode(getActiveUiLanguage());
  refreshEntireDocument();

  observer = new MutationObserver(handleMutations);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRIBUTES,
  });

  languageListener = (event) => onLanguageChanged(event);
  window.addEventListener("feedarr:ui-language-changed", languageListener);
  initialized = true;
}

export function disposeRuntimeTranslation() {
  if (!initialized) return;

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (languageListener && typeof window !== "undefined") {
    window.removeEventListener("feedarr:ui-language-changed", languageListener);
  }
  languageListener = null;
  initialized = false;
}
