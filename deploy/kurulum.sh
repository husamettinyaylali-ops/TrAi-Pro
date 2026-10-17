#!/usr/bin/env bash
# TrAi Pro — boş bir Ubuntu (22.04/24.04) ya da Debian 12 sunucuya kurulum.
#
# Depo klasöründe çalıştırın:
#   sudo bash deploy/kurulum.sh
#
# Seçenekler:
#   --evet                  Soru sormaz; .env önceden doldurulmuş olmalı.
#   --guvenlik-duvari-yok   ufw ayarlanmaz (sağlayıcının güvenlik duvarını kullanıyorsanız).
#
# Betik tekrar çalıştırılabilir: kurulu olanı atlar, .env'i denetler, uygulamayı
# yeniden derleyip başlatır. Ayrıntılar: deploy/YAYIN.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
YES=0
FIREWALL=1
OS_ID=""
OS_CODENAME=""

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31mHATA:\033[0m %s\n' "$*" >&2
  exit 1
}

# .env'deki KEY'in değeri; çevreleyen tırnaklar atılır, yoksa boş.
env_get() {
  [[ -f "$ENV_FILE" ]] || return 0
  awk -v k="$1" '
    index($0, k "=") == 1 {
      v = substr($0, length(k) + 2)
      if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) v = substr(v, 2, length(v) - 2)
      print v
      exit
    }' "$ENV_FILE"
}

# Docker Compose'un .env okuyucusu için güvenli yazım: düz değer olduğu gibi,
# boşluk ya da özel karakter içeren değer tek tırnakla (içinde $ yorumlanmaz),
# tek tırnak içeren değer kaçışlı çift tırnakla.
env_quote() {
  local v="$1"
  if [[ "$v" =~ ^[A-Za-z0-9_@.:/+,=-]*$ ]]; then
    printf '%s' "$v"
  elif [[ "$v" != *"'"* ]]; then
    printf "'%s'" "$v"
  else
    v="${v//\\/\\\\}"
    v="${v//\"/\\\"}"
    v="${v//\$/\\\$}"
    printf '"%s"' "$v"
  fi
}

# KEY=değer satırını yazar (yoksa sona ekler); dosyanın izinleri korunur.
env_set() {
  local tmp
  tmp="$(mktemp)"
  K="$1" V="$(env_quote "$2")" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" >"$tmp"
  cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

# Soru sorar; boş bırakılırsa mevcut değer kalır. Üçüncü argüman verilirse yazılan görünmez.
ask() {
  local key="$1" prompt="$2" secret="${3:-}" current value
  current="$(env_get "$key")"
  if [[ -n "$secret" ]]; then
    read -r -s -p "$prompt${current:+ [kayıtlı; değiştirmek için yazın]}: " value </dev/tty
    echo
  else
    read -r -p "$prompt${current:+ [$current]}: " value </dev/tty
  fi
  if [[ -n "$value" ]]; then env_set "$key" "$value"; fi
  return 0
}

check_system() {
  [[ $EUID -eq 0 ]] || die "Root olarak çalıştırın: sudo bash deploy/kurulum.sh"
  [[ -f "$ROOT/docker-compose.yml" ]] || die "docker-compose.yml bulunamadı; betiği depo klasöründen çalıştırın."
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu | debian) ;;
    *) die "Yalnız Ubuntu ve Debian desteklenir (bulunan: ${ID:-bilinmiyor})." ;;
  esac
  OS_ID="$ID"
  OS_CODENAME="${VERSION_CODENAME:-}"
  [[ -n "$OS_CODENAME" ]] || die "Dağıtımın kod adı okunamadı (/etc/os-release)."
}

# Az bellekli sunucuda derleme ve video kodlama için takas alanı.
ensure_swap() {
  local mem_mb
  mem_mb="$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)"
  if ((mem_mb < 3000)) && [[ -z "$(swapon --show 2>/dev/null)" ]]; then
    say "Bellek ${mem_mb} MB; derleme ve video için 2 GB takas alanı açılıyor"
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    say "Docker kurulu: $(docker --version)"
    return
  fi
  say "Docker kuruluyor (Docker'ın resmî apt deposundan)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$OS_ID $OS_CODENAME stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker >/dev/null
  say "Docker kuruldu: $(docker --version)"
}

setup_firewall() {
  if ((!FIREWALL)); then
    warn "Güvenlik duvarı atlandı (--guvenlik-duvari-yok); 80 ve 443 dışarıya açık olmalı."
    return
  fi
  export DEBIAN_FRONTEND=noninteractive
  command -v ufw >/dev/null 2>&1 || apt-get install -y -qq ufw >/dev/null
  local ssh_port
  ssh_port="$(sshd -T 2>/dev/null | awk '/^port / { print $2; exit }')"
  ssh_port="${ssh_port:-22}"
  # Önce SSH: bağlantınız kopmasın.
  ufw allow "$ssh_port/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  say "Güvenlik duvarı açık: SSH ($ssh_port), 80, 443"
}

configure_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ROOT/.env.example" "$ENV_FILE"
    say ".env, .env.example'dan oluşturuldu"
  fi
  chmod 600 "$ENV_FILE"
  if ((!YES)); then
    say "Temel ayarlar (boş bırakırsanız mevcut değer kalır; diğer anahtarları sonra .env'e yazabilirsiniz)"
    ask DOMAIN "Alan adı (ör. trai.ornek.com)"
    ask ADMIN_EMAILS "Yönetici e-postası (sitede bu adresle hesap açacaksınız)"
    ask SMTP_HOST "SMTP sunucusu (ör. smtp.ornek.com)"
    ask SMTP_PORT "SMTP portu (587 ya da 465)"
    ask SMTP_USER "SMTP kullanıcı adı"
    ask SMTP_PASS "SMTP şifresi" gizli
    ask EMAIL_FROM "Gönderen (ör. TrAi Pro <bildirim@ornek.com>)"
  fi

  local domain public
  domain="$(env_get DOMAIN)"
  [[ -n "$domain" ]] || die ".env'de DOMAIN boş."
  [[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] ||
    die "DOMAIN geçerli bir alan adı değil: $domain (https:// ve / olmadan yazın)."
  public="$(env_get PUBLIC_URL)"
  if [[ -z "$public" ]]; then
    env_set PUBLIC_URL "https://$domain"
  elif [[ "$public" != "https://$domain" ]]; then
    warn "PUBLIC_URL https://$domain olmalı (şu an: $public); e-posta bağlantıları ve webhook'lar bundan kurulur."
  fi
  [[ "$(env_get DEMO_PAYMENTS)" != "on" ]] ||
    die "DEMO_PAYMENTS=on yayında olamaz (kullanıcılar ödemeden bakiye yükler); .env'den kaldırın."
  [[ -n "$(env_get ADMIN_EMAILS)" ]] || warn "ADMIN_EMAILS boş: yönetim paneline kimse giremez."
  if [[ -z "$(env_get SMTP_HOST)" || -z "$(env_get EMAIL_FROM)" ]]; then
    warn "SMTP_HOST ya da EMAIL_FROM boş: doğrulama e-postası gitmez, kullanıcılar deneme kredisini alamaz."
  fi
}

check_dns() {
  local domain ip resolved
  domain="$(env_get DOMAIN)"
  ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  resolved="$(getent ahostsv4 "$domain" 2>/dev/null | awk '{ print $1; exit }' || true)"
  if [[ -z "$resolved" ]]; then
    warn "$domain henüz çözülmüyor: alan adının A kaydını bu sunucuya (${ip:-sunucunun IP adresi}) yönlendirin; Caddy sertifikayı kayıt yayılınca alır."
  elif [[ -n "$ip" && "$resolved" != "$ip" ]]; then
    warn "$domain → $resolved, ama bu sunucu $ip. A kaydını düzeltin; yoksa HTTPS sertifikası alınamaz."
  else
    say "DNS doğru: $domain → $resolved"
  fi
}

start_app() {
  say "Uygulama derlenip başlatılıyor (ilk derleme birkaç dakika sürer)"
  cd "$ROOT"
  docker compose up -d --build
  say "Sağlık kontrolü bekleniyor"
  local id status
  id="$(docker compose ps -q app)"
  for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || echo yok)"
    if [[ "$status" == healthy ]]; then
      say "Uygulama çalışıyor"
      return
    fi
    sleep 5
  done
  docker compose logs --tail 50 app >&2
  die "Uygulama 5 dakikada hazır olmadı; yukarıdaki kayıtlara bakın."
}

check_https() {
  local domain
  domain="$(env_get DOMAIN)"
  for _ in $(seq 1 24); do
    if curl -fsS --max-time 10 "https://$domain/health" >/dev/null 2>&1; then
      say "https://$domain yayında"
      return
    fi
    sleep 5
  done
  warn "https://$domain/health henüz yanıt vermiyor. DNS yayılınca Caddy sertifikayı alır; 'docker compose logs caddy' ile izleyin."
}

summary() {
  local domain
  domain="$(env_get DOMAIN)"
  cat <<EOF

Kurulum tamam. Sıradaki adımlar (ayrıntı: deploy/YAYIN.md):
  1. https://$domain adresinde ADMIN_EMAILS'teki e-postayla hesap açın ve e-postayı doğrulayın.
  2. https://$domain/admin → Kurulum durumu: her servisi "Bağlantıyı test et" ile deneyin.
  3. Eksik anahtarları .env'e yazın, sonra: docker compose up -d
  4. Dış servis panelleri:
       Google yönlendirme adresi : https://$domain/auth/google/callback
       PayPal webhook            : https://$domain/webhooks/paypal
  5. Duman testi (kendi bilgisayarınızda): node deploy/duman-testi.mjs https://$domain
  Güncelleme: sudo bash deploy/guncelle.sh
EOF
}

main() {
  for arg in "$@"; do
    case "$arg" in
      --evet) YES=1 ;;
      --guvenlik-duvari-yok) FIREWALL=0 ;;
      -h | --help)
        sed -n '2,13p' "${BASH_SOURCE[0]}"
        exit 0
        ;;
      *) die "Bilinmeyen seçenek: $arg" ;;
    esac
  done
  check_system
  ensure_swap
  install_docker
  setup_firewall
  configure_env
  check_dns
  start_app
  check_https
  summary
}

# Testte fonksiyonlar `source` ile yüklenir; doğrudan çalıştırılınca kurulum başlar.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
