<p align="center">
  <img src="docs/screenshots/logo.png" alt="Logo Poisonarr" width="140" />
</p>

<h1 align="center">Poisonarr</h1>

<p align="center">
  <strong>Un installateur, une interface – et toutes les applications *arr empoisonnées.</strong><br/>
  Tableau de bord des flux torrent, demandes Seerr et toute la pile Plex + *arr au même endroit.
</p>

<p align="center">
  <a href="README.md">English</a> | Français | <a href="README.hu.md">Magyar</a>
</p>

<p align="center">
  <a href="https://github.com/NagyRichard09/Poison/releases"><img src="https://img.shields.io/github/v/release/NagyRichard09/Poison?include_prereleases" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-GPL--3.0-blue" alt="Licence" /></a>
  <img src="https://img.shields.io/badge/.NET-10-512BD4" alt=".NET 10" />
  <img src="https://img.shields.io/badge/Proxmox-LXC-E57000" alt="Proxmox LXC" />
</p>

---

## Qu'est-ce que Poisonarr ?

Poisonarr est un centre multimédia auto-hébergé. Une seule commande Proxmox installe et relie Plex,
Seerr, Prowlarr, Sonarr, Radarr, Tautulli et qBittorrent, et son interface affiche au même endroit
les dernières releases de vos sites torrent, vos demandes Seerr et toutes ces applications.

## Fonctionnalités

**Installation et configuration**
- **Un installateur pour tout** – Plex, Poisonarr, Seerr, Prowlarr, Sonarr, Radarr, Tautulli et
  qBittorrent, en natif (sans Docker) dans un seul conteneur LXC Debian 13.
- **Assistant dans le navigateur** – Plex → Radarr → Sonarr → Prowlarr → Seerr → qBittorrent →
  Tautulli → Poisonarr, avec un identifiant et un mot de passe communs.
- **Commande `poisonarr`** – statut, mise à jour, redémarrage, journaux, identifiants.

**Tableau de bord des releases**
- Agrège les flux Torznab de Prowlarr et Jackett : catégories, filtres, Top 24h.
- Bibliothèque avec affiches, métadonnées TMDB, TVmaze, Fanart, IGDB et autres.
- Notes IMDb / Rotten Tomatoes / Metascore via OMDb.

**Intégrations**
- **Centre d'applications** – toutes les applications dans la barre latérale, intégrées ou dans un
  nouvel onglet, avec indicateur d'état et connexion automatique en un clic.
- **Seerr** – réception des webhooks, association automatique des releases, envoi vers Sonarr/Radarr.
- **Plex** – bibliothèques Films et Séries créées automatiquement.
- **Notifications** – Discord, ntfy et webhook générique.
- **Stockage** – espace libre par disque, alertes, barre optionnelle sur l'écran principal.

**Sécurité**
- Authentification (mode smart / strict), clés API chiffrées, sauvegarde et restauration.
- Interface en français, anglais et hongrois.

## Installation sur Proxmox (recommandée)

Dans le shell de l'hôte Proxmox VE :

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NagyRichard09/Poison/main/proxmox/feedarr-stack-lxc.sh)"
```

L'installation dure 15 à 30 minutes. Ouvrez ensuite `http://<IP du conteneur>:8888` : l'assistant
vous guide à travers les applications. Détails : [proxmox/README.md](proxmox/README.md) (en hongrois).

## Docker (Poisonarr seul)

```bash
git clone https://github.com/NagyRichard09/Poison.git && cd Poison
docker compose -f docker/docker-compose.yml up -d --build
```

Interface : `http://localhost:8888`. Détails : [README.dockerhub.md](README.dockerhub.md).

## Configuration

Au premier démarrage, Poisonarr reste verrouillé tant que l'assistant (`/setup`, ou `/stack-setup`
sur une installation Proxmox) n'est pas terminé. Si l'instance est exposée sur Internet, activez
l'authentification et utilisez un reverse proxy TLS.

Guides : [assistant de configuration](docs/configuration-wizard.fr.md) ·
[English](docs/configuration-wizard.md)

## Développement

Prérequis : .NET SDK 10, Node.js 22.

```bash
dotnet run --project src/Feedarr.Api/Feedarr.Api.csproj -p:BuildWeb=true
cd src/Feedarr.Web/feedarr-web && npm ci && npm run dev
```

Les noms internes du code (`Feedarr.Api`, `/var/lib/feedarr`, service `feedarr`) sont conservés
volontairement pour que les installations et données existantes continuent de fonctionner.

## Support

- Bugs et idées : https://github.com/NagyRichard09/Poison/issues
- Versions : https://github.com/NagyRichard09/Poison/releases

## Auteur et licence

Poisonarr est créé et maintenu par **NagyRichard09**.

Sous licence GNU GPL v3, voir [LICENSE](LICENSE).

Poisonarr s'appuie sur le code source de [Feedarr](https://github.com/Guizmos/Feedarr) (GPL-3.0)
de Guizmos ; les droits d'auteur du code d'origine restent à son auteur.
