<p align="center"><img src="docs/screenshots/logo.png" alt="Poisonarr logó" width="140" /></p>

# Poisonarr

A Poisonarr a [Feedarr](https://github.com/Guizmos/Feedarr) release dashboard továbbfejlesztett,
magyar felhasználóknak szánt változata (GPL-3.0): egy felületen a torrent feedek, a Seerr
kérések és a teljes *arr* rendszer.

## Mit tud ez a változat?

- **Egy telepítő, minden app** – Plex, Poisonarr, Seerr, Prowlarr, Sonarr, Radarr, Tautulli és
  qBittorrent egy Proxmox LXC konténerben, böngészős beállító varázslóval (Plexszel kezd).

- **Alkalmazás-központ** – Seerr, Prowlarr, Sonarr, Radarr, Tautulli, qBittorrent az
  oldalsávban, a Poisonarr-on belül beágyazva vagy új lapon, elérhetőség-jelzéssel;
  egy kattintásos automatikus összekötés (API kulcsok kiolvasása, Prowlarr/Sonarr/
  Radarr/qBittorrent/Seerr bekötése).
- **Seerr integráció** – webhook fogadás (Overseerr / Jellyseerr / Seerr), automatikus
  release egyeztetés (évad-alapú, magyar release előnyben, minimum seeder),
  küldés Sonarr/Radarr-ba (`release/push`).
- **Értesítések** – Discord, ntfy, általános webhook (új kérés, megérkezett tartalom,
  arr küldés, kevés tárhely).
- **Tárhely** – szabad hely a meghajtókon (Beállítások → Tárhely), opcionális sáv a
  főképernyőn, figyelmeztetés és értesítés kevés helynél.
- **Magyar metaadatok** – magyar cím/leírás (TMDB hu-HU), IMDb / Rotten Tomatoes /
  Metascore értékelés (OMDb), „Csak magyar” szűrő, rendezés értékelés szerint.
- **.NET 10** (LTS, 2028-ig támogatott).

## Telepítés Proxmoxra (ajánlott)

A Proxmox VE host shelljében:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NagyRichard09/Poison/main/proxmox/feedarr-stack-lxc.sh)"
```

Részletek: [proxmox/README.md](proxmox/README.md).

## Docker

A `docker/Dockerfile` továbbra is használható csak a Poisonarr futtatására:

```bash
docker build -f docker/Dockerfile -t poisonarr .
```

## Dokumentáció

- [Proxmox telepítő](proxmox/README.md)
- [Seerr, Sonarr/Radarr küldés, értesítések, tárhely](docs/seerr-es-ertesitesek.md)
- [CHANGELOG](CHANGELOG.md)

## Licenc

GPL-3.0 – az eredeti projekt: [Guizmos/Feedarr](https://github.com/Guizmos/Feedarr).
