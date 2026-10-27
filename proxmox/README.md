<p align="center"><img src="../docs/screenshots/logo.png" alt="Poisonarr" width="120" /></p>

# Poisonarr – Proxmox LXC telepítő (natív, Docker nélkül)

Egyetlen paranccsal létrehoz egy Debian 13 LXC konténert a Proxmox VE-n, és beletelepíti:

| Alkalmazás | Port | Mire való | Telepítés forrása |
|---|---|---|---|
| Plex Media Server | 32400 | médiaszerver: lejátszás tévén, telefonon, böngészőben (`/web`) | hivatalos Plex tároló (`repo.plex.tv`) |
| **Poisonarr** | 8888 | központi felület, release-ek, Seerr kérések, alkalmazás-menü | ez a repó (forrásból fordítva, .NET 10) |
| Seerr | 5055 | film/sorozat kérések (Plex / Jellyfin / Emby) | hivatalos GitHub release (forrásból fordítva) |
| Prowlarr | 9696 | indexer kezelő | hivatalos Servarr csomag |
| Sonarr | 8989 | sorozatok | hivatalos Sonarr v4 csomag |
| Radarr | 7878 | filmek | hivatalos Servarr csomag |
| Tautulli | 8181 | Plex statisztika | hivatalos GitHub release |
| qBittorrent | 8090 | torrent kliens (WebUI) | Debian csomag (`qbittorrent-nox`) |

Minden alkalmazás **systemd szolgáltatásként** fut a közös `media` felhasználóval
(UID/GID 1000; a Plex a saját `plex` felhasználójával, a `media` csoport tagjaként), a beállítások a `/var/lib/<alkalmazás>` mappában, a média a
`/srv/media/{downloads,tv,movies}` mappában van.

## 1. Előfeltétel: a projekt a GitHubon

A telepítő a Poisonarr forrását a GitHubról tölti le (alapértelmezés:
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
| Hostname | `poisonarr` |
| CPU / RAM / swap | 4 mag / 6144 MB / 2048 MB |
| Rendszerlemez | 40 GB a `local-lvm` tárhelyen |
| Hálózat | `vmbr0`, DHCP (vagy fix IP, pl. `192.168.1.50/24` + átjáró, VLAN) |
| Média mappa a hoston | üres = a konténer lemezén; pl. `/tank/media` → `/srv/media` |

A telepítés 15–30 perc (a Seerr és a Poisonarr fordítása tart a legtovább).
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

## 3. Első lépések a telepítés után – beállító varázsló

Nyisd meg a Poisonarr-t: `http://<ip>:8888`. Az első indításkor a **Poisonarr beállító** fogad,
ami sorban végigvezet az alkalmazásokon:

| # | Lépés | Mit csinál |
|---|-------|------------|
| 1 | **Kezdés** | Nyelv (alapból magyar), egy **közös felhasználónév + jelszó** minden programhoz. Ez lesz a Poisonarr belépése is – mentés után a böngésző egyszer bekéri. |
| 2 | **Plex** | A [plex.tv/claim](https://www.plex.tv/claim) kóddal a szerver a Plex fiókodhoz kerül; szervernév, „Filmek” (`/srv/media/movies`) és „Sorozatok” (`/srv/media/tv`) könyvtár magyar metaadatokkal |
| 3 | **Radarr** | Belépés, magyar felület és film adatok, `/srv/media/movies`, qBittorrent letöltő kliens, bekötés a Poisonarr-ba |
| 4 | **Sonarr** | Ugyanez sorozatokra, `/srv/media/tv` |
| 5 | **Prowlarr** | Belépés, Sonarr/Radarr szinkron, Poisonarr; a beágyazott Prowlarrban add hozzá az indexereidet (pl. nCore) |
| 6 | **Seerr** | A beágyazott Seerrben „Sign in with Plex”, utána „Bekötés most”: Sonarr/Radarr szerverek, magyar nyelv, webhook → Poisonarr |
| 7 | **qBittorrent** | WebUI belépés a közös jelszóval, letöltési mappa, radarr/sonarr kategóriák, seed arány |
| 8 | **Tautulli** | A beágyazott Tautulli varázslóban Plex belépés, szerverként a helyi Plex (`127.0.0.1`, port `32400`), majd „Ellenőrzés” |
| 9 | **Poisonarr** | Oldalsáv „Alkalmazások” menü, majd a Poisonarr saját beállításai (metaadat szolgáltatók, indexerek) |

Bármelyik lépés kihagyható és később pótolható (**Beállítások → Alkalmazás-központ**).
A „Helyi hálózatról ne kérjen jelszót” opcióval a Radarr/Sonarr/Prowlarr a helyi hálózatról
belépés nélkül nyílik meg (így beágyazva is működnek); internet felől mindig kér jelszót.

A telepítő által generált jelszavak: `pct exec <CTID> -- poisonarr credentials`.

### Hardveres átkódolás (opcionális)

Intel/AMD GPU-val a Plex sokkal kevesebb CPU-t használ átkódoláskor (Plex Pass szükséges).
A Proxmox hoston (PVE 8.2+):

```bash
pct exec <CTID> -- getent group render          # pl. render:x:993: → a GID 993
pct set <CTID> --dev0 /dev/dri/renderD128,gid=993
pct exec <CTID> -- usermod -aG render plex
pct reboot <CTID>
```

Utána a Plexben: Beállítások → Átkódoló → „Hardveres gyorsítás használata, ha elérhető”.

## 4. Kezelés

A konténerben (`pct enter <CTID>`) vagy a hostról (`pct exec <CTID> -- …`):

```bash
poisonarr status            # állapot + címek
poisonarr update            # minden frissítése
poisonarr update seerr      # csak egy alkalmazás
poisonarr restart sonarr
poisonarr logs poisonarr    # napló követése
poisonarr update plex       # Plex frissítése (apt)
poisonarr credentials       # telepítéskor generált jelszavak
```

A Sonarr, Radarr, Prowlarr és Tautulli a saját beépített frissítőjével is frissül;
a qBittorrent az `apt`-tal, a Seerr és a Poisonarr a `poisonarr update` paranccsal.

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
| A Seerr fordítása megszakad | adj több RAM-ot (`pct set <CTID> -memory 6144`), majd `poisonarr update seerr` |
| Nem tölti le a Poisonarr forrást | nyilvános a repó? létezik a `main` ág? |
| qBittorrent nem jelenik meg beágyazva | a telepítő kikapcsolja a clickjacking védelmet; régebbi konfignál WebUI → „Clickjacking védelem” ki, vagy „új lap” mód |
| Valami nem indul | `poisonarr logs <app>`, telepítési napló: `/var/log/feedarr-stack-install.log` |

## Licenc

A Poisonarr-t NagyRichard09 készíti, GPL-3.0 licenccel (lásd `LICENSE`); a
[Feedarr](https://github.com/Guizmos/Feedarr) forráskódjára épül. A többi alkalmazás a saját hivatalos
forrásából, a saját licence alatt települ; a telepítő nem módosítja őket.
