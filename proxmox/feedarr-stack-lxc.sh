#!/usr/bin/env bash
# =============================================================================
#  Poisonarr – Proxmox VE LXC creator
#
#  Run in the Proxmox VE HOST shell (as root):
#
#    bash -c "$(curl -fsSL https://raw.githubusercontent.com/NagyRichard09/Poison/main/proxmox/feedarr-stack-lxc.sh)"
#
#  Creates an unprivileged Debian 13 LXC and installs natively (no Docker):
#    Plex · Poisonarr · Seerr · Prowlarr · Sonarr · Radarr · Tautulli · qBittorrent
#
#  Non-interactive: set the variables below as environment variables and
#  add YES=1, e.g.  CTID=210 MEMORY=6144 MEDIA_HOST_PATH=/tank/media YES=1 bash feedarr-stack-lxc.sh
# =============================================================================
set -Eeuo pipefail

FEEDARR_REPO="${FEEDARR_REPO:-NagyRichard09/Poison}"
FEEDARR_BRANCH="${FEEDARR_BRANCH:-main}"

CTID="${CTID:-}"
CT_HOSTNAME="${CT_HOSTNAME:-poisonarr}"
CORES="${CORES:-4}"
MEMORY="${MEMORY:-6144}"          # MB – Seerr build ~3 GB, Plex transcoding
SWAP="${SWAP:-2048}"              # MB
DISK_GB="${DISK_GB:-40}"          # Plex metadata grows with the library
ROOTFS_STORAGE="${ROOTFS_STORAGE:-}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
VLAN="${VLAN:-}"
IP_CONFIG="${IP_CONFIG:-dhcp}"    # dhcp | 192.168.1.50/24
GATEWAY="${GATEWAY:-}"
MEDIA_HOST_PATH="${MEDIA_HOST_PATH:-}"   # host folder bind-mounted to /srv/media (optional)
CT_PASSWORD="${CT_PASSWORD:-}"
YES="${YES:-0}"

C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_INFO=$'\e[36m'; C_B=$'\e[1m'; C_OFF=$'\e[0m'
msg()  { printf '%s➜%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s✔%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s⚠%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die()  { printf '%s✖%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }
trap 'die "Hiba a(z) $LINENO. sorban: $BASH_COMMAND"' ERR

ask() { # var prompt default
  local __var="$1" __prompt="$2" __default="$3" __answer=""
  if [[ "$YES" == "1" ]]; then printf -v "$__var" '%s' "$__default"; return; fi
  read -r -p "  ${__prompt} [${__default}]: " __answer </dev/tty || true
  printf -v "$__var" '%s' "${__answer:-$__default}"
}

confirm() { # prompt -> 0 yes
  [[ "$YES" == "1" ]] && return 0
  local a=""
  read -r -p "  $1 [i/N]: " a </dev/tty || true
  [[ "$a" =~ ^([iIyY]|igen|yes)$ ]]
}

# ----------------------------------------------------------------------------- checks
[[ $EUID -eq 0 ]] || die "Root jogosultság szükséges."
command -v pveversion >/dev/null && command -v pct >/dev/null \
  || die "Ezt a scriptet a Proxmox VE host shelljében kell futtatni (pct / pveversion nem található)."
ok "Proxmox: $(pveversion | head -n1)"

printf '\n%s Poisonarr – natív LXC telepítő %s\n' "$C_B" "$C_OFF"
printf '  Plex · Poisonarr · Seerr · Prowlarr · Sonarr · Radarr · Tautulli · qBittorrent\n'
printf '  Forrás: https://github.com/%s (%s)\n\n' "$FEEDARR_REPO" "$FEEDARR_BRANCH"

# ----------------------------------------------------------------------------- settings
[[ -n "$CTID" ]] || CTID="$(pvesh get /cluster/nextid)"
if [[ -z "$ROOTFS_STORAGE" ]]; then
  if pvesm status -content rootdir 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "local-lvm"; then
    ROOTFS_STORAGE="local-lvm"
  else
    ROOTFS_STORAGE="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}')"
  fi
fi
[[ -n "$ROOTFS_STORAGE" ]] || die "Nem található LXC tárhely (rootdir tartalommal)."

ask CTID            "Konténer ID"                                   "$CTID"
ask CT_HOSTNAME     "Hostname"                                      "$CT_HOSTNAME"
ask CORES           "CPU magok"                                     "$CORES"
ask MEMORY          "Memória (MB, min. 4096 ajánlott)"              "$MEMORY"
ask SWAP            "Swap (MB)"                                     "$SWAP"
ask DISK_GB         "Rendszerlemez (GB)"                            "$DISK_GB"
ask ROOTFS_STORAGE  "Tárhely a rendszerlemeznek"                    "$ROOTFS_STORAGE"
ask BRIDGE          "Hálózati bridge"                               "$BRIDGE"
ask VLAN            "VLAN tag (üres = nincs)"                       "$VLAN"
ask IP_CONFIG       "IP cím (dhcp vagy pl. 192.168.1.50/24)"        "$IP_CONFIG"
if [[ "$IP_CONFIG" != "dhcp" ]]; then
  ask GATEWAY       "Átjáró (gateway)"                              "${GATEWAY:-$(ip route | awk '/default/ {print $3; exit}')}"
fi
ask MEDIA_HOST_PATH "Host mappa a médiának → /srv/media (üres = a konténer lemezén)" "$MEDIA_HOST_PATH"

[[ "$CTID" =~ ^[0-9]+$ ]] || die "Érvénytelen konténer ID: $CTID"
pct status "$CTID" >/dev/null 2>&1 && die "A(z) $CTID ID már foglalt."
[[ "$MEMORY" =~ ^[0-9]+$ && "$CORES" =~ ^[0-9]+$ && "$DISK_GB" =~ ^[0-9]+$ && "$SWAP" =~ ^[0-9]+$ ]] \
  || die "A CPU / memória / swap / lemez értéke csak szám lehet."
[[ "$MEMORY" -lt 3072 ]] && warn "3 GB alatti memóriával a Seerr fordítása valószínűleg nem fog sikerülni."
if [[ "$IP_CONFIG" != "dhcp" && ! "$IP_CONFIG" =~ ^[0-9.]+/[0-9]+$ ]]; then
  die "Az IP címet CIDR formában add meg (pl. 192.168.1.50/24) vagy 'dhcp'."
fi
if [[ -n "$MEDIA_HOST_PATH" ]]; then
  [[ "$MEDIA_HOST_PATH" == /* ]] || die "A host mappa abszolút útvonal legyen."
  if [[ ! -d "$MEDIA_HOST_PATH" ]]; then
    confirm "A(z) $MEDIA_HOST_PATH nem létezik. Létrehozzam?" || die "Megszakítva."
    mkdir -p "$MEDIA_HOST_PATH"
  fi
fi

if [[ -z "$CT_PASSWORD" ]]; then
  CT_PASSWORD="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
fi

printf '\n  %sÖsszegzés%s: CT %s (%s) · %s mag · %s MB RAM · %s GB @ %s · %s/%s%s\n' \
  "$C_B" "$C_OFF" "$CTID" "$CT_HOSTNAME" "$CORES" "$MEMORY" "$DISK_GB" "$ROOTFS_STORAGE" "$BRIDGE" "$IP_CONFIG" \
  "${MEDIA_HOST_PATH:+ · média: $MEDIA_HOST_PATH}"
confirm "Indulhat a telepítés?" || die "Megszakítva."

# ----------------------------------------------------------------------------- template
msg "Debian 13 sablon keresése…"
pveam update >/dev/null 2>&1 || warn "pveam update nem sikerült, a helyi listát használom."
TEMPLATE="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^debian-13-standard_.*_amd64\.tar\.(zst|xz|gz)$' | sort -V | tail -n1 || true)"
if [[ -z "$TEMPLATE" ]]; then
  TEMPLATE="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^debian-12-standard_.*_amd64\.tar\.(zst|xz|gz)$' | sort -V | tail -n1 || true)"
  [[ -n "$TEMPLATE" ]] && warn "Debian 13 sablon nem érhető el, Debian 12-t használok: $TEMPLATE"
fi
[[ -n "$TEMPLATE" ]] || die "Nem található Debian sablon (pveam available)."
if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  msg "Sablon letöltése: $TEMPLATE"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
fi
ok "Sablon: $TEMPLATE"

# ----------------------------------------------------------------------------- create
NET="name=eth0,bridge=${BRIDGE},ip=${IP_CONFIG}"
[[ "$IP_CONFIG" != "dhcp" && -n "$GATEWAY" ]] && NET="${NET},gw=${GATEWAY}"
[[ -n "$VLAN" ]] && NET="${NET},tag=${VLAN}"

msg "LXC létrehozása (CT $CTID)…"
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap "$SWAP" \
  --rootfs "${ROOTFS_STORAGE}:${DISK_GB}" \
  --net0 "$NET" \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --ostype debian \
  --tags "poisonarr;media" \
  --description "Poisonarr: Plex, Seerr, Prowlarr, Sonarr, Radarr, Tautulli, qBittorrent (https://github.com/${FEEDARR_REPO})" \
  --password "$CT_PASSWORD" >/dev/null
ok "CT $CTID létrehozva"

if [[ -n "$MEDIA_HOST_PATH" ]]; then
  pct set "$CTID" -mp0 "${MEDIA_HOST_PATH},mp=/srv/media,backup=0"
  # Unprivileged LXC: container uid/gid 1000 ("media") = host 101000
  for d in "" downloads downloads/incomplete tv movies; do mkdir -p "${MEDIA_HOST_PATH}/${d}"; done
  chown 101000:101000 "$MEDIA_HOST_PATH" "$MEDIA_HOST_PATH"/{downloads,downloads/incomplete,tv,movies}
  chmod 0775 "$MEDIA_HOST_PATH" "$MEDIA_HOST_PATH"/{downloads,downloads/incomplete,tv,movies}
  if [[ -n "$(find "$MEDIA_HOST_PATH" -mindepth 2 -maxdepth 3 -not -user 101000 -print -quit 2>/dev/null)" ]]; then
    if confirm "A(z) $MEDIA_HOST_PATH már tartalmaz fájlokat. Átadjam őket a konténer 'media' felhasználójának (chown -R 101000:101000)?"; then
      chown -R 101000:101000 "$MEDIA_HOST_PATH"
    else
      warn "A meglévő fájlok tulajdonosa nem változott; ha a Sonarr/Radarr nem tudja írni őket, futtasd: chown -R 101000:101000 $MEDIA_HOST_PATH"
    fi
  fi
  ok "Média mappa csatolva: $MEDIA_HOST_PATH → /srv/media"
fi

msg "Konténer indítása…"
pct start "$CTID"
for _ in $(seq 1 60); do
  if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then break; fi
  sleep 2
done
pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 || die "A konténernek nincs hálózata / DNS-e."
ok "Hálózat rendben"

# Time zone and locale from the host
HOST_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo Etc/UTC)"
pct exec "$CTID" -- bash -c "ln -sf /usr/share/zoneinfo/${HOST_TZ} /etc/localtime && echo ${HOST_TZ} > /etc/timezone" || true

# ----------------------------------------------------------------------------- install
# Use the local installer only when this script was started from a file (git clone / zip),
# not via bash -c "$(curl …)".
SCRIPT_DIR="/nonexistent"
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
pct exec "$CTID" -- env LANG=C.UTF-8 LC_ALL=C.UTF-8 bash -c "export DEBIAN_FRONTEND=noninteractive; echo LANG=C.UTF-8 > /etc/default/locale; apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null"
if [[ -f "$SCRIPT_DIR/install-stack.sh" ]]; then
  msg "Telepítő másolása a konténerbe (helyi példány)…"
  pct push "$CTID" "$SCRIPT_DIR/install-stack.sh" /root/install-stack.sh --perms 0755
else
  msg "Telepítő letöltése a konténerben…"
  pct exec "$CTID" -- bash -c "curl -fsSL -o /root/install-stack.sh https://raw.githubusercontent.com/${FEEDARR_REPO}/${FEEDARR_BRANCH}/proxmox/install-stack.sh && chmod 0755 /root/install-stack.sh"
fi

msg "Alkalmazások telepítése a konténerben (15–30 perc, főleg a Seerr fordítása miatt)…"
pct exec "$CTID" -- env LANG=C.UTF-8 LC_ALL=C.UTF-8 FEEDARR_REPO="$FEEDARR_REPO" FEEDARR_BRANCH="$FEEDARR_BRANCH" bash /root/install-stack.sh \
  || die "A telepítés megszakadt. Folytatás (a kész lépéseket kihagyja):
  pct exec $CTID -- bash -c \"curl -fsSL -o /root/install-stack.sh https://raw.githubusercontent.com/${FEEDARR_REPO}/${FEEDARR_BRANCH}/proxmox/install-stack.sh && bash /root/install-stack.sh\""

CT_IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
printf '\n%s════════════════════════════════════════════════════════════════%s\n' "$C_OK" "$C_OFF"
printf ' %sKész!%s  Poisonarr: %shttp://%s:8888%s  ← ezt nyisd meg, a varázsló a Plexszel kezd\n' "$C_B" "$C_OFF" "$C_B" "$CT_IP" "$C_OFF"
printf '  Plex:      http://%s:32400/web\n' "$CT_IP"
printf '  Konténer: CT %s (%s), root jelszó: %s\n' "$CTID" "$CT_HOSTNAME" "$CT_PASSWORD"
printf '  Jelszavak a konténerben: pct exec %s -- poisonarr credentials\n' "$CTID"
printf '  Frissítés:               pct exec %s -- poisonarr update\n' "$CTID"
printf '%s════════════════════════════════════════════════════════════════%s\n' "$C_OK" "$C_OFF"
