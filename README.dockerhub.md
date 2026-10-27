# Poisonarr – Docker

Poisonarr in a single container (API and web UI together, no nginx).
The image is built from this repository; the full stack (Plex, Seerr, Prowlarr, Sonarr, Radarr,
Tautulli, qBittorrent) is installed by the [Proxmox installer](proxmox/README.md) instead.

## Build and run

```bash
git clone https://github.com/NagyRichard09/Poison.git && cd Poison
docker compose -f docker/docker-compose.yml up -d --build
```

or without Compose:

```bash
docker build -f docker/Dockerfile -t poisonarr:local .
docker run -d --name poisonarr -p 8888:8080 -v "$PWD/data:/app/data" \
  -e PUID=$(id -u) -e PGID=$(id -g) poisonarr:local
```

Endpoints:

- Web UI: `http://localhost:8888`
- API: `http://localhost:8888/api`
- Health: `http://localhost:8888/health`

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `ASPNETCORE_URLS` | `http://+:8080` | listen address inside the container |
| `App__DataDir` | `/app/data` | database, posters, keys, backups |
| `PUID` / `PGID` | `10001` | owner of the files in the data volume |
| `FEEDARR_MASTER_KEY` | – | optional stable encryption key (otherwise generated in `/app/data/keys`) |

Keep `/app/data` on a volume: it holds the database and the encryption keys.

## Reverse proxy

Point your reverse proxy to `http://poisonarr:8080` (or `http://<host>:8888`). HTTPS should be
terminated by the proxy. Enable authentication when the instance is reachable from the internet.

## Source and license

- Source: https://github.com/NagyRichard09/Poison
- Author: NagyRichard09
- License: GNU GPL v3 – based on [Feedarr](https://github.com/Guizmos/Feedarr) by Guizmos
