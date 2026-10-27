<p align="center">
  <img src="docs/screenshots/logo.png" alt="Poisonarr logo" width="140" />
</p>

<h1 align="center">Poisonarr</h1>

<p align="center">
  <strong>One installer, one interface – and every *arr app poisoned.</strong><br/>
  Torrent feed dashboard, Seerr requests and the whole Plex + *arr stack in one place.
</p>

<p align="center">
  English | <a href="README.fr.md">Français</a> | <a href="README.hu.md">Magyar</a>
</p>

<p align="center">
  <a href="https://github.com/NagyRichard09/Poison/releases"><img src="https://img.shields.io/github/v/release/NagyRichard09/Poison?include_prereleases" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="License" /></a>
  <img src="https://img.shields.io/badge/.NET-10-512BD4" alt=".NET 10" />
  <img src="https://img.shields.io/badge/Proxmox-LXC-E57000" alt="Proxmox LXC" />
</p>

---

## What is Poisonarr?

Poisonarr is a self-hosted media hub. A single Proxmox command installs and wires together Plex,
Seerr, Prowlarr, Sonarr, Radarr, Tautulli and qBittorrent, and its own interface shows the latest
releases of your torrent sites, your Seerr requests and all of these apps in one place.

## Features

**Installation and setup**
- **One installer, every app** – Plex, Poisonarr, Seerr, Prowlarr, Sonarr, Radarr, Tautulli and
  qBittorrent, native (no Docker) in a single Debian 13 LXC container.
- **Browser setup wizard** – Plex → Radarr → Sonarr → Prowlarr → Seerr → qBittorrent → Tautulli →
  Poisonarr, with one shared username and password.
- **`poisonarr` command** – status, update, restart, logs, credentials.

**Release dashboard**
- Aggregates Torznab feeds from Prowlarr and Jackett: categories, filters, Top 24h.
- Poster library view with metadata from TMDB, TVmaze, Fanart, IGDB and more.
- Hungarian metadata (titles, overviews), IMDb / Rotten Tomatoes / Metascore ratings via OMDb.

**Integrations**
- **App hub** – every app in the sidebar, embedded in Poisonarr or in a new tab, with status
  indicators and one-click automatic connection.
- **Seerr** – webhook intake, automatic release matching (season-aware, minimum seeders),
  push to Sonarr/Radarr.
- **Plex** – Movies and TV libraries created automatically.
- **Notifications** – Discord, ntfy and generic webhooks.
- **Storage** – free space per drive, low-space warnings, optional main-screen bar.

**Security**
- Authentication (smart / strict mode), API keys encrypted at rest, backup and restore.
- UI in English, French and Hungarian.

## Install on Proxmox (recommended)

In the Proxmox VE host shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NagyRichard09/Poison/main/proxmox/feedarr-stack-lxc.sh)"
```

Installation takes 15–30 minutes. Then open `http://<container IP>:8888` and the setup wizard
guides you through the apps. Ports, management and troubleshooting:
[proxmox/README.md](proxmox/README.md) (Hungarian).

## Docker (Poisonarr only)

```bash
git clone https://github.com/NagyRichard09/Poison.git && cd Poison
docker compose -f docker/docker-compose.yml up -d --build
```

UI: `http://localhost:8888`. Details: [README.dockerhub.md](README.dockerhub.md).

## Configuration

On first run Poisonarr stays locked until the setup wizard (`/setup`, or `/stack-setup` on a
Proxmox install) is completed. For deployments reachable from the internet, enable authentication
and use a TLS reverse proxy.

Main pages: settings (`/settings`), providers (`/settings/providers`), app hub (`/settings/hub`),
storage (`/settings/storage`), backup (`/settings/backup`), indexers (`/indexers`),
Seerr requests (`/seerr`).

Guides: [setup wizard](docs/configuration-wizard.md) · [Français](docs/configuration-wizard.fr.md) ·
[Seerr and notifications (Hungarian)](docs/seerr-es-ertesitesek.md)

## Development

Requirements: .NET SDK 10, Node.js 22.

```bash
# backend + web UI
dotnet run --project src/Feedarr.Api/Feedarr.Api.csproj -p:BuildWeb=true

# web UI only, with the dev server
cd src/Feedarr.Web/feedarr-web && npm ci && npm run dev
```

Project and internal names in the source (`Feedarr.Api`, `/var/lib/feedarr`, the `feedarr` service)
are kept on purpose so that existing installations and data keep working.

## Support

- Issues and ideas: https://github.com/NagyRichard09/Poison/issues
- Releases: https://github.com/NagyRichard09/Poison/releases
- Changes: [CHANGELOG.md](CHANGELOG.md)

## Author and license

Poisonarr is created and maintained by **NagyRichard09**.

Licensed under the GNU GPL v3, see [LICENSE](LICENSE).

Poisonarr is built on the source code of [Feedarr](https://github.com/Guizmos/Feedarr) (GPL-3.0)
by Guizmos; copyright of the original code remains with its author.
