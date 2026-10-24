#!/usr/bin/env bash
# =============================================================================
#  Feedarr Stack – native installer (no Docker)
#
#  Installs into one Debian 13 / Ubuntu 24.04+ system (Proxmox LXC or VM):
#    Feedarr (8888) · Seerr (5055) · Prowlarr (9696) · Sonarr (8989)
#    Radarr (7878) · Tautulli (8181) · qBittorrent (8090)
#
#  Every app runs as a systemd service under the shared "media" user, with
#  config in /var/lib/<app> and media in /srv/media/{downloads,tv,movies}.
#
#  Usage (as root, inside the container / VM):
#    bash install-stack.sh                 # install everything
#    FEEDARR_REPO=owner/repo FEEDARR_BRANCH=main bash install-stack.sh
#
#  After installation:  feedarr-stack status | update | restart | logs <app> | credentials
# =============================================================================
set -Eeuo pipefail

FEEDARR_REPO="${FEEDARR_REPO:-NagyRichard09/Poison}"
FEEDARR_BRANCH="${FEEDARR_BRANCH:-main}"
MEDIA_USER="${MEDIA_USER:-media}"
MEDIA_UID="${MEDIA_UID:-1000}"
MEDIA_GID="${MEDIA_GID:-1000}"
MEDIA_ROOT="${MEDIA_ROOT:-/srv/media}"
STACK_DIR="/opt/feedarr-stack"
CREDENTIALS_FILE="/root/feedarr-stack-credentials.txt"
LOG_FILE="/var/log/feedarr-stack-install.log"

PORT_FEEDARR=8888
PORT_SEERR=5055
PORT_PROWLARR=9696
PORT_SONARR=8989
PORT_RADARR=7878
PORT_TAUTULLI=8181
PORT_QBIT=8090

# ----------------------------------------------------------------------------- helpers
C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_INFO=$'\e[36m'; C_OFF=$'\e[0m'
msg()  { printf '%s➜%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s✔%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s⚠%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die()  { printf '%s✖%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }
trap 'die "Hiba a(z) $LINENO. sorban (parancs: $BASH_COMMAND). Részletek: $LOG_FILE"' ERR

run() { "$@" >>"$LOG_FILE" 2>&1; }

retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    [[ $n -ge 4 ]] && return 1
    warn "Újrapróbálás ($n/3): $*"
    sleep $((n * 5))
  done
}

download() { # url dest
  retry curl -fsSL --retry 3 --connect-timeout 20 -o "$2" "$1"
}

gh_latest_tarball() { # owner/repo -> prints "tag url"
  local json
  json="$(retry curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$1/releases/latest")"
  jq -r '"\(.tag_name) \(.tarball_url)"' <<<"$json"
}

require_root() { [[ $EUID -eq 0 ]] || die "Root jogosultság szükséges (sudo bash $0)."; }

detect_arch() {
  case "$(dpkg --print-architecture)" in
    amd64) ARR_ARCH="x64" ;;
    arm64) ARR_ARCH="arm64" ;;
    *) die "Nem támogatott architektúra: $(dpkg --print-architecture) (csak amd64 / arm64)." ;;
  esac
}

check_os() {
  [[ -r /etc/os-release ]] || die "Ismeretlen operációs rendszer."
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    debian|ubuntu) ;;
    *) die "Csak Debian / Ubuntu támogatott (talált: ${PRETTY_NAME:-?})." ;;
  esac
  ok "Rendszer: ${PRETTY_NAME:-$ID}"
}

check_resources() {
  local mem_mb
  mem_mb=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 ))
  if [[ $mem_mb -lt 3000 ]]; then
    warn "Kevés memória (${mem_mb} MB). A Seerr és a Feedarr fordításához legalább 4 GB RAM + swap ajánlott."
  fi
}

write_unit() { # name content
  printf '%s\n' "$2" >"/etc/systemd/system/$1.service"
}

# ----------------------------------------------------------------------------- base
install_base() {
  msg "Alapcsomagok telepítése…"
  export DEBIAN_FRONTEND=noninteractive
  run apt-get update
  run apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg jq git tar unzip xz-utils sudo \
    sqlite3 libsqlite3-0 libicu-dev mediainfo \
    python3 python3-venv python3-pip \
    build-essential python3-setuptools \
    qbittorrent-nox
  ok "Alapcsomagok telepítve"
}

create_user_and_dirs() {
  msg "Felhasználó és mappák (${MEDIA_USER}, ${MEDIA_ROOT})…"
  if ! getent group "$MEDIA_USER" >/dev/null; then
    if getent group "$MEDIA_GID" >/dev/null; then groupadd "$MEDIA_USER"; else groupadd -g "$MEDIA_GID" "$MEDIA_USER"; fi
  fi
  if ! id "$MEDIA_USER" >/dev/null 2>&1; then
    if getent passwd "$MEDIA_UID" >/dev/null; then
      useradd -r -g "$MEDIA_USER" -d /var/lib/feedarr-stack -s /usr/sbin/nologin "$MEDIA_USER"
    else
      useradd -r -u "$MEDIA_UID" -g "$MEDIA_USER" -d /var/lib/feedarr-stack -s /usr/sbin/nologin "$MEDIA_USER"
    fi
  fi

  local d
  for d in feedarr seerr prowlarr sonarr radarr tautulli qbittorrent feedarr-stack; do
    install -d -o "$MEDIA_USER" -g "$MEDIA_USER" -m 0775 "/var/lib/$d"
  done
  install -d -m 0775 "$MEDIA_ROOT"
  for d in downloads downloads/incomplete tv movies; do
    install -d -m 0775 "$MEDIA_ROOT/$d"
  done
  # Do not chown recursively: a bind-mounted media folder may already contain data.
  chown "$MEDIA_USER:$MEDIA_USER" "$MEDIA_ROOT" "$MEDIA_ROOT"/{downloads,downloads/incomplete,tv,movies} 2>/dev/null \
    || warn "A ${MEDIA_ROOT} jogosultsága nem állítható (bind mount?). Lásd a README jogosultság részét."
  install -d -m 0755 "$STACK_DIR"
  ok "Felhasználó: $MEDIA_USER ($(id -u "$MEDIA_USER"):$(id -g "$MEDIA_USER"))"
}

# ----------------------------------------------------------------------------- *arr apps
# name dir url port
install_arr() {
  local name="$1" bin="$2" url="$3" port="$4"
  local lname tmp
  lname="$(tr '[:upper:]' '[:lower:]' <<<"$name")"
  msg "$name telepítése…"
  tmp="$(mktemp -d)"
  download "$url" "$tmp/$lname.tar.gz"
  tar -xzf "$tmp/$lname.tar.gz" -C "$tmp"
  [[ -d "$tmp/$name" ]] || die "$name: váratlan csomag szerkezet."
  systemctl stop "$lname" 2>/dev/null || true
  rm -rf "/opt/$name"
  mv "$tmp/$name" "/opt/$name"
  chown -R "$MEDIA_USER:$MEDIA_USER" "/opt/$name"
  rm -rf "$tmp"

  write_unit "$lname" "[Unit]
Description=$name Daemon
After=network-online.target
Wants=network-online.target

[Service]
User=$MEDIA_USER
Group=$MEDIA_USER
UMask=0002
Type=simple
ExecStart=/opt/$name/$bin -nobrowser -data=/var/lib/$lname
TimeoutStopSec=20
KillMode=process
Restart=on-failure

[Install]
WantedBy=multi-user.target"
  run systemctl daemon-reload
  run systemctl enable --now "$lname"
  ok "$name fut: http://<ip>:$port"
}

install_sonarr() {
  install_arr "Sonarr" "Sonarr" \
    "https://services.sonarr.tv/v1/download/main/latest?version=4&os=linux&arch=${ARR_ARCH}" "$PORT_SONARR"
}
install_radarr() {
  install_arr "Radarr" "Radarr" \
    "https://radarr.servarr.com/v1/update/master/updatefile?os=linux&runtime=netcore&arch=${ARR_ARCH}" "$PORT_RADARR"
}
install_prowlarr() {
  install_arr "Prowlarr" "Prowlarr" \
    "https://prowlarr.servarr.com/v1/update/master/updatefile?os=linux&runtime=netcore&arch=${ARR_ARCH}" "$PORT_PROWLARR"
}

# ----------------------------------------------------------------------------- qBittorrent
qbit_password_hash() { # password -> @ByteArray(salt:hash)  (PBKDF2-HMAC-SHA512, 100000 iterations)
  QBIT_PW="$1" python3 - <<'PY'
import base64, hashlib, os
pw = os.environ["QBIT_PW"].encode()
salt = os.urandom(16)
dk = hashlib.pbkdf2_hmac("sha512", pw, salt, 100000, 64)
print("@ByteArray(%s:%s)" % (base64.b64encode(salt).decode(), base64.b64encode(dk).decode()))
PY
}

install_qbittorrent() {
  msg "qBittorrent beállítása…"
  local conf_dir="/var/lib/qbittorrent/qBittorrent/config"
  local conf="$conf_dir/qBittorrent.conf"
  install -d -o "$MEDIA_USER" -g "$MEDIA_USER" -m 0775 "$conf_dir"

  if [[ ! -f "$conf" ]]; then
    QBIT_USER="admin"
    QBIT_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16 || true)"
    local hash
    hash="$(qbit_password_hash "$QBIT_PASS")"
    cat >"$conf" <<EOF
[LegalNotice]
Accepted=true

[BitTorrent]
Session\\DefaultSavePath=${MEDIA_ROOT}/downloads
Session\\TempPath=${MEDIA_ROOT}/downloads/incomplete
Session\\TempPathEnabled=true

[Preferences]
Downloads\\SavePath=${MEDIA_ROOT}/downloads
Downloads\\TempPath=${MEDIA_ROOT}/downloads/incomplete
Downloads\\TempPathEnabled=true
WebUI\\Port=${PORT_QBIT}
WebUI\\Username=${QBIT_USER}
WebUI\\Password_PBKDF2="${hash}"
WebUI\\ClickjackingProtection=false
WebUI\\HostHeaderValidation=false
WebUI\\LocalHostAuth=true
Connection\\UPnP=false
EOF
    chown "$MEDIA_USER:$MEDIA_USER" "$conf"
    chmod 0660 "$conf"
    printf 'qBittorrent WebUI  felhasználó: %s  jelszó: %s\n' "$QBIT_USER" "$QBIT_PASS" >>"$CREDENTIALS_FILE"
  else
    warn "qBittorrent konfiguráció már létezik, nem írom felül."
  fi

  # --confirm-legal-notice exists since qBittorrent 5.0 (Debian 13); older builds read [LegalNotice] from the config.
  local legal_flag=""
  local qbit_help
  qbit_help="$(qbittorrent-nox --help 2>&1 || true)"
  if [[ "$qbit_help" == *"--confirm-legal-notice"* ]]; then legal_flag=" --confirm-legal-notice"; fi

  write_unit "qbittorrent" "[Unit]
Description=qBittorrent-nox (WebUI)
After=network-online.target
Wants=network-online.target

[Service]
User=$MEDIA_USER
Group=$MEDIA_USER
UMask=0002
Type=simple
ExecStart=/usr/bin/qbittorrent-nox --profile=/var/lib/qbittorrent --webui-port=${PORT_QBIT}${legal_flag}
Restart=on-failure
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target"
  run systemctl daemon-reload
  run systemctl enable --now qbittorrent
  ok "qBittorrent fut: http://<ip>:${PORT_QBIT}"
}

# ----------------------------------------------------------------------------- Tautulli
install_tautulli() {
  msg "Tautulli telepítése…"
  local tag url tmp
  read -r tag url < <(gh_latest_tarball "Tautulli/Tautulli")
  tmp="$(mktemp -d)"
  download "$url" "$tmp/tautulli.tar.gz"
  systemctl stop tautulli 2>/dev/null || true
  rm -rf /opt/Tautulli
  install -d /opt/Tautulli
  tar -xzf "$tmp/tautulli.tar.gz" -C /opt/Tautulli --strip-components=1
  rm -rf "$tmp"
  echo "$tag" >/opt/Tautulli/version.txt
  echo "master" >/opt/Tautulli/branch.txt

  run python3 -m venv /opt/Tautulli/.venv
  run /opt/Tautulli/.venv/bin/pip install --upgrade pip
  run /opt/Tautulli/.venv/bin/pip install -r /opt/Tautulli/requirements.txt
  run /opt/Tautulli/.venv/bin/pip install pyopenssl "setuptools<81"
  chown -R "$MEDIA_USER:$MEDIA_USER" /opt/Tautulli

  write_unit "tautulli" "[Unit]
Description=Tautulli
After=network-online.target
Wants=network-online.target

[Service]
User=$MEDIA_USER
Group=$MEDIA_USER
Type=simple
WorkingDirectory=/opt/Tautulli
ExecStart=/opt/Tautulli/.venv/bin/python3 /opt/Tautulli/Tautulli.py --datadir /var/lib/tautulli --config /var/lib/tautulli/config.ini --port ${PORT_TAUTULLI} --nolaunch --quiet
KillSignal=SIGINT
TimeoutStopSec=20
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target"
  run systemctl daemon-reload
  run systemctl enable --now tautulli
  ok "Tautulli $tag fut: http://<ip>:${PORT_TAUTULLI}"
}

# ----------------------------------------------------------------------------- Node.js / .NET
install_nodejs() {
  local major=""
  if command -v node >/dev/null; then major="$(node -p 'process.versions.node.split(".")[0]')"; fi
  if [[ "$major" != "22" ]]; then
    msg "Node.js 22 telepítése (NodeSource)…"
    install -d -m 0755 /etc/apt/keyrings
    retry curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      >/etc/apt/sources.list.d/nodesource.list
    run apt-get update
    run apt-get install -y nodejs
  fi
  ok "Node.js $(node -v)"
}

install_dotnet() {
  if ! /usr/share/dotnet/dotnet --list-sdks 2>/dev/null | grep -q '^10\.'; then
    msg ".NET 10 SDK telepítése…"
    download "https://dot.net/v1/dotnet-install.sh" /tmp/dotnet-install.sh
    run bash /tmp/dotnet-install.sh --channel 10.0 --install-dir /usr/share/dotnet
    rm -f /tmp/dotnet-install.sh
    ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
  fi
  export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
  ok ".NET SDK $(/usr/share/dotnet/dotnet --version)"
}

# ----------------------------------------------------------------------------- Seerr
build_seerr() { # tag url
  local tag="$1" url="$2" tmp pnpm_version
  tmp="$(mktemp -d)"
  download "$url" "$tmp/seerr.tar.gz"
  install -d "$tmp/src"
  tar -xzf "$tmp/seerr.tar.gz" -C "$tmp/src" --strip-components=1

  pnpm_version="$(jq -r '(.packageManager // "") | select(startswith("pnpm@")) | sub("^pnpm@"; "") | sub("\\+.*$"; "")' "$tmp/src/package.json")"
  [[ -n "$pnpm_version" ]] || pnpm_version="10"
  run npm install -g "pnpm@${pnpm_version}"

  msg "Seerr $tag fordítása (több percig tarthat)…"
  (
    cd "$tmp/src"
    export CYPRESS_INSTALL_BINARY=0 NODE_OPTIONS="--max-old-space-size=3072" NEXT_TELEMETRY_DISABLED=1
    pnpm install --frozen-lockfile
    pnpm build
  ) >>"$LOG_FILE" 2>&1 || die "A Seerr fordítása nem sikerült (kevés RAM?). Részletek: $LOG_FILE"

  systemctl stop seerr 2>/dev/null || true
  rm -rf /opt/seerr.old
  [[ -d /opt/seerr ]] && mv /opt/seerr /opt/seerr.old
  mv "$tmp/src" /opt/seerr
  echo "$tag" >/opt/seerr/.feedarr-stack-release
  chown -R "$MEDIA_USER:$MEDIA_USER" /opt/seerr
  rm -rf "$tmp" /opt/seerr.old
}

install_seerr() {
  msg "Seerr telepítése…"
  local tag url
  read -r tag url < <(gh_latest_tarball "seerr-team/seerr")
  build_seerr "$tag" "$url"

  install -d -m 0755 /etc/seerr
  cat >/etc/seerr/seerr.conf <<EOF
PORT=${PORT_SEERR}
HOST=0.0.0.0
CONFIG_DIRECTORY=/var/lib/seerr
NODE_ENV=production
EOF

  write_unit "seerr" "[Unit]
Description=Seerr
After=network-online.target
Wants=network-online.target

[Service]
User=$MEDIA_USER
Group=$MEDIA_USER
Type=exec
EnvironmentFile=/etc/seerr/seerr.conf
WorkingDirectory=/opt/seerr
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target"
  run systemctl daemon-reload
  run systemctl enable --now seerr
  ok "Seerr $tag fut: http://<ip>:${PORT_SEERR}"
}

# ----------------------------------------------------------------------------- Feedarr
build_feedarr() {
  local src=/opt/feedarr-src
  if [[ -d "$src/.git" ]]; then
    run git -C "$src" fetch --depth 1 origin "$FEEDARR_BRANCH"
    run git -C "$src" reset --hard "origin/$FEEDARR_BRANCH"
  else
    rm -rf "$src"
    run git clone --depth 1 --branch "$FEEDARR_BRANCH" "https://github.com/${FEEDARR_REPO}.git" "$src" \
      || die "A Feedarr forrás nem tölthető le: https://github.com/${FEEDARR_REPO} (nyilvános a repó? létezik a '$FEEDARR_BRANCH' ág?)"
  fi

  # Repo root may be the project itself or contain a Feedarr-main/ folder
  local root="$src"
  [[ -f "$src/Feedarr-main/src/Feedarr.Api/Feedarr.Api.csproj" ]] && root="$src/Feedarr-main"
  [[ -f "$root/src/Feedarr.Api/Feedarr.Api.csproj" ]] || die "Nem található a src/Feedarr.Api/Feedarr.Api.csproj a repóban."

  msg "Feedarr webes felület fordítása…"
  (
    cd "$root/src/Feedarr.Web/feedarr-web"
    npm ci --no-audit --no-fund
    npm run build
  ) >>"$LOG_FILE" 2>&1 || die "A Feedarr webes felület fordítása nem sikerült. Részletek: $LOG_FILE"

  msg "Feedarr szerver fordítása (.NET 10)…"
  local out
  out="$(mktemp -d)"
  (
    cd "$root"
    export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
    /usr/share/dotnet/dotnet publish src/Feedarr.Api/Feedarr.Api.csproj -c Release -o "$out" -p:BuildWebOnPublish=false
  ) >>"$LOG_FILE" 2>&1 || die "A Feedarr fordítása nem sikerült. Részletek: $LOG_FILE"
  # Same layout as the Docker image: the React build is served from wwwroot/
  install -d "$out/wwwroot"
  cp -a "$root/src/Feedarr.Web/feedarr-web/dist/." "$out/wwwroot/"

  systemctl stop feedarr 2>/dev/null || true
  rm -rf /opt/feedarr
  mv "$out" /opt/feedarr
  git -C "$src" rev-parse --short HEAD >/opt/feedarr/.feedarr-stack-commit 2>/dev/null || true
  chown -R "$MEDIA_USER:$MEDIA_USER" /opt/feedarr
}

install_feedarr() {
  msg "Feedarr telepítése (${FEEDARR_REPO}@${FEEDARR_BRANCH})…"
  build_feedarr

  install -d -m 0755 /etc/feedarr
  if [[ ! -f /etc/feedarr/feedarr.env ]]; then
    cat >/etc/feedarr/feedarr.env <<EOF
ASPNETCORE_URLS=http://0.0.0.0:${PORT_FEEDARR}
ASPNETCORE_ENVIRONMENT=Production
App__DataDir=/var/lib/feedarr
App__AppConfigRoot=/var/lib
App__InternalUrl=http://127.0.0.1:${PORT_FEEDARR}
DOTNET_CLI_TELEMETRY_OPTOUT=1
DOTNET_ROOT=/usr/share/dotnet
EOF
  fi

  write_unit "feedarr" "[Unit]
Description=Feedarr
After=network-online.target
Wants=network-online.target

[Service]
User=$MEDIA_USER
Group=$MEDIA_USER
UMask=0002
Type=simple
EnvironmentFile=/etc/feedarr/feedarr.env
WorkingDirectory=/opt/feedarr
ExecStart=/usr/share/dotnet/dotnet /opt/feedarr/Feedarr.Api.dll
Restart=on-failure
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target"
  run systemctl daemon-reload
  run systemctl enable --now feedarr
  ok "Feedarr fut: http://<ip>:${PORT_FEEDARR}"
}

# ----------------------------------------------------------------------------- feedarr-stack CLI
install_cli() {
  cat >/usr/local/bin/feedarr-stack <<'CLI'
#!/usr/bin/env bash
# feedarr-stack – manage the native Feedarr stack
set -Eeuo pipefail
APPS=(feedarr seerr prowlarr sonarr radarr tautulli qbittorrent)
declare -A PORTS=([feedarr]=8888 [seerr]=5055 [prowlarr]=9696 [sonarr]=8989 [radarr]=7878 [tautulli]=8181 [qbittorrent]=8090)
INSTALLER=/opt/feedarr-stack/install-stack.sh

usage() {
  cat <<EOF
Használat: feedarr-stack <parancs> [alkalmazás]

  status                 szolgáltatások állapota és címek
  update [app|all]       frissítés (alapértelmezett: all)
  restart [app|all]      újraindítás
  logs <app>             napló követése (journalctl -f)
  credentials            telepítéskor generált jelszavak

Alkalmazások: ${APPS[*]}
EOF
}

ip_addr() { hostname -I 2>/dev/null | awk '{print $1}'; }

status() {
  local ip; ip="$(ip_addr)"
  printf '%-12s %-10s %s\n' "ALKALMAZÁS" "ÁLLAPOT" "CÍM"
  for a in "${APPS[@]}"; do
    printf '%-12s %-10s http://%s:%s\n' "$a" "$(systemctl is-active "$a" 2>/dev/null || true)" "$ip" "${PORTS[$a]}"
  done
}

target_apps() {
  if [[ -z "${1:-}" || "$1" == "all" ]]; then echo "${APPS[@]}"; return; fi
  [[ -n "${PORTS[$1]:-}" ]] || { echo "Ismeretlen alkalmazás: $1" >&2; exit 1; }
  echo "$1"
}

case "${1:-}" in
  status) status ;;
  restart) for a in $(target_apps "${2:-}"); do systemctl restart "$a"; echo "✔ $a újraindítva"; done ;;
  logs) [[ -n "${2:-}" ]] || { usage; exit 1; }; journalctl -u "$2" -f -n 100 ;;
  credentials) cat /root/feedarr-stack-credentials.txt 2>/dev/null || echo "Nincs mentett jelszó." ;;
  update) [[ $EUID -eq 0 ]] || { echo "Root szükséges." >&2; exit 1; }; bash "$INSTALLER" --update "${2:-all}" ;;
  ""|-h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
CLI
  chmod 0755 /usr/local/bin/feedarr-stack
}

# ----------------------------------------------------------------------------- update
update_apps() {
  local target="${1:-all}"
  local apps=(feedarr seerr prowlarr sonarr radarr tautulli qbittorrent)
  [[ "$target" == "all" ]] || apps=("$target")
  detect_arch
  for a in "${apps[@]}"; do
    case "$a" in
      sonarr)   install_sonarr ;;
      radarr)   install_radarr ;;
      prowlarr) install_prowlarr ;;
      tautulli) install_tautulli ;;
      qbittorrent)
        msg "qBittorrent frissítése (apt)…"
        run apt-get update
        run apt-get install -y --only-upgrade qbittorrent-nox
        run systemctl restart qbittorrent
        ok "qBittorrent $(qbittorrent-nox --version 2>/dev/null | head -n1)" ;;
      seerr)
        local tag url current=""
        read -r tag url < <(gh_latest_tarball "seerr-team/seerr")
        [[ -f /opt/seerr/.feedarr-stack-release ]] && current="$(cat /opt/seerr/.feedarr-stack-release)"
        if [[ "$tag" == "$current" ]]; then
          ok "Seerr már a legfrissebb ($tag)"
        else
          install_nodejs
          build_seerr "$tag" "$url"
          run systemctl restart seerr
          ok "Seerr frissítve: $current → $tag"
        fi ;;
      feedarr)
        install_dotnet
        install_nodejs
        build_feedarr
        run systemctl restart feedarr
        ok "Feedarr frissítve ($(cat /opt/feedarr/.feedarr-stack-commit 2>/dev/null || echo '?'))" ;;
      *) die "Ismeretlen alkalmazás: $a" ;;
    esac
  done
}

# ----------------------------------------------------------------------------- summary
print_summary() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  cat <<EOF

${C_OK}════════════════════════════════════════════════════════════════${C_OFF}
 Feedarr Stack telepítve
${C_OK}════════════════════════════════════════════════════════════════${C_OFF}
  Feedarr      http://${ip}:${PORT_FEEDARR}   ← ezt nyisd meg először
  Seerr        http://${ip}:${PORT_SEERR}
  Prowlarr     http://${ip}:${PORT_PROWLARR}
  Sonarr       http://${ip}:${PORT_SONARR}
  Radarr       http://${ip}:${PORT_RADARR}
  Tautulli     http://${ip}:${PORT_TAUTULLI}
  qBittorrent  http://${ip}:${PORT_QBIT}

  Jelszavak:   ${CREDENTIALS_FILE}
  Média:       ${MEDIA_ROOT}/{downloads,tv,movies}

 Következő lépések:
  1. Feedarr: futtasd végig a telepítő varázslót.
  2. Seerr: jelentkezz be a Plex / Jellyfin / Emby fiókoddal (első indítás).
  3. Feedarr → Beállítások → Alkalmazás-központ → "Összekötés indítása"
     (a qBittorrent jelszót a fenti fájlban találod).
  4. Prowlarr: add hozzá az indexereidet – a Sonarr/Radarr automatikusan megkapja.

  Kezelés: feedarr-stack status | update | restart | logs <app> | credentials
EOF
}

# ----------------------------------------------------------------------------- main
main() {
  require_root
  install -d -m 0755 "$(dirname "$LOG_FILE")"
  : >>"$LOG_FILE"

  if [[ "${1:-}" == "--update" ]]; then
    update_apps "${2:-all}"
    exit 0
  fi

  msg "Feedarr Stack telepítése – napló: $LOG_FILE"
  check_os
  detect_arch
  check_resources
  install_base
  create_user_and_dirs
  touch "$CREDENTIALS_FILE"; chmod 0600 "$CREDENTIALS_FILE"

  # Keep a copy of this installer for "feedarr-stack update"
  if [[ -f "${BASH_SOURCE[0]:-}" ]]; then
    install -m 0755 "${BASH_SOURCE[0]}" "$STACK_DIR/install-stack.sh"
  else
    download "https://raw.githubusercontent.com/${FEEDARR_REPO}/${FEEDARR_BRANCH}/proxmox/install-stack.sh" "$STACK_DIR/install-stack.sh"
    chmod 0755 "$STACK_DIR/install-stack.sh"
  fi
  # Make FEEDARR_REPO / BRANCH sticky for later updates
  sed -i \
    -e "s|^FEEDARR_REPO=.*|FEEDARR_REPO=\"\${FEEDARR_REPO:-${FEEDARR_REPO}}\"|" \
    -e "s|^FEEDARR_BRANCH=.*|FEEDARR_BRANCH=\"\${FEEDARR_BRANCH:-${FEEDARR_BRANCH}}\"|" \
    "$STACK_DIR/install-stack.sh"

  install_sonarr
  install_radarr
  install_prowlarr
  install_qbittorrent
  install_tautulli
  install_nodejs
  install_seerr
  install_dotnet
  install_feedarr
  install_cli
  print_summary
}

main "$@"
