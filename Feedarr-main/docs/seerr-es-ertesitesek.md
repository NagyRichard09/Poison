# Seerr integráció, Sonarr/Radarr küldés és értesítések

## 1. Seerr (Overseerr / Jellyseerr) webhook

Seerr → **Settings → Notifications → Webhook**

| Mező | Érték |
|---|---|
| Webhook URL | `http(s)://<feedarr>/api/seerr/webhook` |
| JSON Payload | *Default* (az alapértelmezett sablon tartalmazza az `image` és `{{extra}}` mezőket) |
| Authorization Header | ha a Feedarr hitelesítést használ: `Basic <base64(felhasználó:jelszó)>` |
| Notification Types | Request Pending, Request Automatically Approved, Request Approved, Request Available, Request Declined |

Több Seerr példány esetén opcionálisan `X-Feedarr-AppId` fejléc adható meg.

A Feedarr eltárolja:
- a kérés állapotát (függőben → jóváhagyva → elérhető; ugyanaz a sor frissül, nincs duplikáció),
- a posztert (`image`) és sorozatnál a kért évadokat (`extra` → „Requested Seasons”).

## 2. Egyeztetés

Minden sikeres RSS sync után (és kézzel a Seerr oldalon) a jóváhagyott kérésekhez release-t keres:

1. TMDB ID egyezés (film és sorozat külön névtér), sorozatnál TVDB ID tartalék.
2. Sorozatnál a kért évad csomagja előnyben, utána az évad epizódjai, végül évad nélküli (komplett) csomagok.
   *Szigorú évad-egyeztetés* bekapcsolva más évadot nem fogad el.
3. *Magyar release előnyben*: `HUN` / magyar hang-felirat címkés release-ek előre kerülnek.
4. *Minimum seeder* alatti release-ek kimaradnak.
5. Döntetlennél a több seeder, majd a frissebb release nyer.

Kérésenként: **Keresés / Újraegyeztetés**, **Törlés**, egyezés után **➜ Sonarr / ➜ Radarr**.

## 3. Küldés Sonarr/Radarr-ba (release push)

A Feedarr a Sonarr/Radarr `POST /api/v3/release/push` végpontjára küldi a release-t
(cím, letöltési link vagy magnet, méret, seederek, indexer, TMDB/TVDB ID). A Sonarr/Radarr
a saját minőségprofilja alapján dönt: az eredmény (elfogadva / elutasítva + ok) a kérésnél látszik.

- Az **alapértelmezett, engedélyezett** Sonarr (sorozat) ill. Radarr (film) alkalmazás kapja.
- A sorozatnak/filmnek már szerepelnie kell a Sonarr/Radarr-ban (Seerr jóváhagyáskor ezt megteszi).
- A letöltési linknek elérhetőnek kell lennie a Sonarr/Radarr gépéről (pl. Jackett/Prowlarr link a helyi hálózaton).
- *Automatikus küldés* bekapcsolva ez egyezéskor magától megtörténik.

API: `POST /api/seerr/requests/{id}/push`

## 4. Értesítések

Seerr oldal → **⚙️ Beállítások → Értesítések**

| Csatorna | Beállítás |
|---|---|
| Discord | csatorna webhook URL (`https://discord.com/api/webhooks/…`) – embed poszterrel |
| ntfy | teljes topic URL (`https://ntfy.sh/<topic>` vagy saját szerver), opcionális access token |
| Általános webhook | bármilyen URL; JSON: `source, event, title, message, url, imageUrl, isError, timestamp, data` |

Események: új Seerr kérés, megérkezett a kért tartalom, Sonarr/Radarr küldés eredménye.
A **Teszt értesítés** gomb a még el nem mentett értékekkel is működik. A titkos értékeket
(URL-ek, token) a Feedarr titkosítva tárolja, és az API soha nem adja vissza.

API: `GET/PUT /api/notifications/settings`, `POST /api/notifications/test`

## 5. Könyvtár

- **Szűrő → Nyelv → 🇭🇺 Csak magyar**: csak magyar hang/felirat címkés release-ek.
- **Tri → Értékelés (IMDb)**: IMDb pontszám szerint (ha nincs, a TMDB értékelés szerint).

## 6. OMDb értékelések

Az OMDb szolgáltató engedélyezése után minden sync után 25 cím értékelése töltődik be
(az ingyenes kulcs napi 1000 kérést enged). Kézi futtatás:
`POST /api/scheduler/media-entities/backfill?mode=ratings&limit=200`

## 7. Tárhely

**Beállítások → Tárhely**

- Meghajtónként a szabad / teljes hely; az azonos lemezen lévő mappák egy sorban
  (Linuxon a `/proc/self/mountinfo` alapján).
- **Figyelt mappák**: pl. `/srv/media/downloads` – Dockerben a konténeren belüli útvonal.
- **Megjelenítés a főképernyőn**: kis sáv a Könyvtár oldal tetején (a × gombbal elrejthető).
- **Figyelmeztetés**: % vagy GB határ; 15 percenként ellenőrzi, és egyszer küld értesítést
  (Discord / ntfy / webhook), amíg a hely vissza nem áll.

API: `GET /api/system/disk-space`, `GET/PUT /api/system/disk-space/settings`

## 8. Alkalmazás-központ

**Beállítások → Alkalmazás-központ** és az oldalsáv „Alkalmazások” szakasza.

- Menüpont alkalmazásonként: böngésző URL (`http://{host}:8989` – a `{host}` a Feedarr
  címére cserélődik), belső URL az állapotfigyeléshez, megnyitás a Feedarr-on belül vagy új lapon.
- Zöld/piros pötty: elérhető-e az alkalmazás (percenként frissül).
- Ha egy alkalmazás tiltja a beágyazást (`X-Frame-Options`), a Feedarr jelzi; ilyenkor „új lap” mód.
- **Automatikus összekötés**: a Feedarr az `App:AppConfigRoot` mappában (natív telepítésnél
  `/var/lib`) megkeresi a `sonarr/config.xml`, `radarr/config.xml`, `prowlarr/config.xml`,
  `seerr/settings.json`, `tautulli/config.ini` fájlokat, kiolvassa az API kulcsokat, és
  beköti az alkalmazásokat egymáshoz. Meglévő beállítást nem ír felül.

API: `GET/PUT /api/app-hub`, `GET /api/app-hub/status`, `GET /api/app-hub/discover`,
`POST /api/app-hub/auto-setup`
