# Feedarr Stack – Proxmox LXC telepítő (natív, Docker nélkül)

Egyetlen paranccsal létrehoz egy Debian 13 LXC konténert a Proxmox VE-n, és beletelepíti:

| Alkalmazás | Port | Mire való | Telepítés forrása |
|---|---|---|---|
| **Feedarr** | 8888 | központi felület, release-ek, Seerr kérések, alkalmazás-menü | ez a repó (forrásból fordítva, .NET 10) |
| Seerr | 5055 | film/sorozat kérések (Plex / Jellyfin / Emby) | hivatalos GitHub release (forrásból fordítva) |
| Prowlarr | 9696 | indexer kezelő | hivatalos Servarr csomag |
| Sonarr | 8989 | sorozatok | hivatalos Sonarr v4 csomag |
| Radarr | 7878 | filmek | hivatalos Servarr csomag |
| Tautulli | 8181 | Plex statisztika | hivatalos GitHub release |
| qBittorrent | 8090 | torrent kliens (WebUI) | Debian csomag (`qbittorrent-nox`) |

Minden alkalmazás **systemd szolgáltatásként** fut a közös `media` felhasználóval
(UID/GID 1000), a beállítások a `/var/lib/<alkalmazás>` mappában, a média a
`/srv/media/{downloads,tv,movies}` mappában van.

## 1. Előfeltétel: a projekt a GitHubon

A telepítő a Feedarr forrását a GitHubról tölti le (alapértelmezés:
`NagyRichard09/Poison`, `main` ág). A repónak **nyilvánosnak** kell lennie, és a
gyökerében kell lennie a projekt tartalmának (`src/`, `proxmox/`, `docker/` …).

## 2. Telepítés a Proxmox host shelljéből

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NagyRichard09/Poison/main/proxmox/feedarr-stack-lxc.sh)"
```

A script megkérdezi (Enter = alapérték):

| Kérdés | Alapérték |
|---|---|
| Konténer ID | következő szabad |
| Hostname | `feedarr-stack` |
| CPU / RAM / swap | 4 mag / 4096 MB / 2048 MB |
| Rendszerlemez | 32 GB a `local-lvm` tárhelyen |
| Hálózat | `vmbr0`, DHCP (vagy fix IP, pl. `192.168.1.50/24` + átjáró, VLAN) |
| Média mappa a hoston | üres = a konténer lemezén; pl. `/tank/media` → `/srv/media` |

A telepítés 15–30 perc (a Seerr és a Feedarr fordítása tart a legtovább).
A végén kiírja a címeket, a konténer root jelszavát és a qBittorrent jelszót.

### Nem interaktív telepítés

```bash
CTID=210 MEMORY=6144 DISK_GB=40 IP_CONFIG=192.168.1.50/24 GATEWAY=192.168.1.1 \
MEDIA_HOST_PATH=/tank/media YES=1 \
bash -c "$(curl -fsSL https://raw.githubusercontent.com/NagyRichard09/Poison/main/proxmox/feedarr-stack-lxc.sh)"
```

Másik repó vagy ág: `FEEDARR_REPO=felhasznalo/repo FEEDARR_BRANCH=dev`.

### Meglévő VM-be / LXC-be

Debian 12/13 vagy Ubuntu 24.04+ rendszeren, rootként:

```bash
curl -fsSL -o install-stack.sh https://raw.githubusercontent.com/NagyRichard09/Poison/main/proxmox/install-stack.sh
bash install-stack.sh
```

## 3. Első lépések a telepítés után

1. **Feedarr** – `http://<ip>:8888`: futtasd végig a telepítő varázslót.
2. **Seerr** – `http://<ip>:5055`: jelentkezz be a Plex / Jellyfin / Emby fiókoddal.
3. **Feedarr → Beállítások → Alkalmazás-központ → „Összekötés indítása”**
   (a qBittorrent jelszó: `pct exec <CTID> -- feedarr-stack credentials`). Ez beállítja:
   - Prowlarr → Feedarr (indexer fournisseur), Sonarr/Radarr → Feedarr
   - Prowlarr → Sonarr/Radarr szinkron (az indexerek automatikusan átkerülnek)
   - qBittorrent → Sonarr/Radarr letöltő kliens, gyökérmappák (`/srv/media/tv`, `/srv/media/movies`)
   - Seerr → Sonarr/Radarr szerverek, Seerr webhook → Feedarr
   - az oldalsáv „Alkalmazások” menüpontjait
4. **Prowlarr**: add hozzá az indexereidet (pl. nCore) – a Sonarr/Radarr megkapja őket.
5. **Tautulli**: kösd össze a Plex szervereddel.

## 4. Kezelés

A konténerben (`pct enter <CTID>`) vagy a hostról (`pct exec <CTID> -- …`):

```bash
feedarr-stack status            # állapot + címek
feedarr-stack update            # minden frissítése
feedarr-stack update seerr      # csak egy alkalmazás
feedarr-stack restart sonarr
feedarr-stack logs feedarr      # napló követése
feedarr-stack credentials       # telepítéskor generált jelszavak
```

A Sonarr, Radarr, Prowlarr és Tautulli a saját beépített frissítőjével is frissül;
a qBittorrent az `apt`-tal, a Seerr és a Feedarr a `feedarr-stack update` paranccsal.

## 5. Jogosultságok (bind mount)

A konténer **unprivileged**, ezért a konténeren belüli `media` (1000) a hoston
**101000** UID/GID-ként látszik. A telepítő a média mappa és az almappák
tulajdonosát erre állítja; meglévő fájloknál rákérdez. Kézzel:

```bash
chown -R 101000:101000 /tank/media
```

## 6. Hibaelhárítás

| Jelenség | Megoldás |
|---|---|
| A Seerr fordítása megszakad | adj több RAM-ot (`pct set <CTID> -memory 6144`), majd `feedarr-stack update seerr` |
| Nem tölti le a Feedarr forrást | nyilvános a repó? létezik a `main` ág? |
| qBittorrent nem jelenik meg beágyazva | a telepítő kikapcsolja a clickjacking védelmet; régebbi konfignál WebUI → „Clickjacking védelem” ki, vagy „új lap” mód |
| Valami nem indul | `feedarr-stack logs <app>`, telepítési napló: `/var/log/feedarr-stack-install.log` |

## Licenc

A Feedarr GPL-3.0 licencű (lásd `LICENSE`). A többi alkalmazás a saját hivatalos
forrásából, a saját licence alatt települ; a telepítő nem módosítja őket.
