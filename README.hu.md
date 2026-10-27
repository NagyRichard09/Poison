<p align="center">
  <img src="docs/screenshots/logo.png" alt="Poisonarr logó" width="140" />
</p>

<h1 align="center">Poisonarr</h1>

<p align="center">
  <strong>Egy telepítő, egy felület – és minden *arr alkalmazás megmérgezve.</strong><br/>
  Torrent feed dashboard, Seerr kérések és a teljes Plex + *arr rendszer egy helyen, magyar felhasználóknak.
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | Magyar
</p>

<p align="center">
  <a href="https://github.com/NagyRichard09/Poison/releases"><img src="https://img.shields.io/github/v/release/NagyRichard09/Poison?include_prereleases" alt="Kiadás" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licenc-GPL--3.0-blue" alt="Licenc" /></a>
  <img src="https://img.shields.io/badge/.NET-10-512BD4" alt=".NET 10" />
  <img src="https://img.shields.io/badge/Proxmox-LXC-E57000" alt="Proxmox LXC" />
</p>

---

## Mi a Poisonarr?

A Poisonarr egy önállóan futtatható médiaközpont. Egyetlen Proxmox paranccsal feltelepíti és
összeköti a Plexet, a Seerrt, a Prowlarrt, a Sonarrt, a Radarrt, a Tautullit és a qBittorrentet,
a saját felületén pedig egy helyen mutatja a torrent oldalak friss release-eit, a Seerr kéréseket
és az összes alkalmazást.

## Funkciók

**Telepítés és beállítás**
- **Egy telepítő, minden app** – Plex, Poisonarr, Seerr, Prowlarr, Sonarr, Radarr, Tautulli és
  qBittorrent natívan (Docker nélkül) egy Debian 13 LXC konténerben.
- **Böngészős beállító varázsló** – Plex → Radarr → Sonarr → Prowlarr → Seerr → qBittorrent →
  Tautulli → Poisonarr sorrendben, egy közös felhasználónévvel és jelszóval, magyar felülettel.
- **`poisonarr` parancs** – állapot, frissítés, újraindítás, naplók, jelszavak.

**Release dashboard**
- Torznab feedek összesítése Prowlarrból és Jackettből, kategóriák, szűrők, toplista (Top 24 óra).
- Poszteres könyvtár nézet, metaadatok TMDB, TVmaze, Fanart, IGDB és más szolgáltatókból.
- **Magyar metaadatok** – magyar cím és leírás, IMDb / Rotten Tomatoes / Metascore értékelés
  (OMDb), „Csak magyar” szűrő, rendezés értékelés szerint.

**Integrációk**
- **Alkalmazás-központ** – az összes app az oldalsávban, a Poisonarr-on belül beágyazva vagy új
  lapon, elérhetőség-jelzéssel; egy kattintásos automatikus összekötés.
- **Seerr** – webhook fogadás, automatikus release egyeztetés (évad-alapú, magyar release előnyben,
  minimum seeder), küldés Sonarr/Radarr-ba.
- **Plex** – automatikus Filmek és Sorozatok könyvtár magyar metaadatokkal.
- **Értesítések** – Discord, ntfy és általános webhook (új kérés, megérkezett tartalom, kevés tárhely).
- **Tárhely** – szabad hely meghajtónként, figyelmeztetés, opcionális sáv a főképernyőn.

**Biztonság**
- Belépés (intelligens / szigorú mód), titkosítva tárolt API kulcsok, mentés és visszaállítás.
- Felület magyarul, angolul és franciául.

## Telepítés Proxmoxra (ajánlott)

A Proxmox VE host shelljében:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NagyRichard09/Poison/main/proxmox/feedarr-stack-lxc.sh)"
```

A telepítés 15–30 perc. Utána nyisd meg a `http://<konténer IP>:8888` címet: a beállító varázsló
végigvezet az alkalmazásokon. Részletek, portok, kezelés és hibaelhárítás:
[proxmox/README.md](proxmox/README.md).

## Docker (csak a Poisonarr)

Ha csak a Poisonarr kell, forrásból Docker image is építhető:

```bash
git clone https://github.com/NagyRichard09/Poison.git && cd Poison
docker compose -f docker/docker-compose.yml up -d --build
```

Felület: `http://localhost:8888`. Részletek: [README.dockerhub.md](README.dockerhub.md).

## Beállítás

Az első indításkor a Poisonarr zárolva marad, amíg a varázsló (`/setup`, Proxmox telepítésnél
`/stack-setup`) le nem fut. Internet felől elérhető telepítésnél kapcsold be a belépést, és
használj TLS-t adó reverse proxyt.

Fontosabb oldalak: Beállítások (`/settings`), Szolgáltatók (`/settings/providers`),
Alkalmazás-központ (`/settings/hub`), Tárhely (`/settings/storage`), Mentés (`/settings/backup`),
Indexerek (`/indexers`), Seerr kérések (`/seerr`).

További leírások:
- [Beállító varázsló lépésről lépésre](docs/configuration-wizard.md) (angol) ·
  [francia](docs/configuration-wizard.fr.md)
- [Seerr és értesítések](docs/seerr-es-ertesitesek.md)

## Fejlesztés

Szükséges: .NET SDK 10, Node.js 22.

```bash
# backend + webes felület egyben
dotnet run --project src/Feedarr.Api/Feedarr.Api.csproj -p:BuildWeb=true

# csak a webes felület, fejlesztői szerverrel
cd src/Feedarr.Web/feedarr-web && npm ci && npm run dev
```

A forráskódban a projektek és a belső nevek (`Feedarr.Api`, `/var/lib/feedarr`, `feedarr`
szolgáltatás) szándékosan maradtak a régiek, így a meglévő telepítések és adatok megmaradnak.

## Hibabejelentés, támogatás

- Hibák és ötletek: https://github.com/NagyRichard09/Poison/issues
- Kiadások: https://github.com/NagyRichard09/Poison/releases
- Változások: [CHANGELOG.md](CHANGELOG.md)

## Készítő és licenc

A Poisonarr-t **NagyRichard09** készíti és tartja karban.

A projekt a GNU GPL v3 licenc alatt érhető el, lásd: [LICENSE](LICENSE).

A Poisonarr a Guizmos által készített [Feedarr](https://github.com/Guizmos/Feedarr) (GPL-3.0)
forráskódjára épül; az eredeti kód szerzői jogai az eredeti szerzőt illetik.
