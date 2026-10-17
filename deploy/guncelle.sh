#!/usr/bin/env bash
# TrAi Pro — güncelleme: kodu çeker, yeni imajı derler, veritabanını yedekler,
# uygulamayı yeniden başlatır ve sağlığını bekler.
#
# Depo klasöründe çalıştırın:
#   sudo bash deploy/guncelle.sh
#
# Yeni imaj eski uygulama çalışırken derlenir; kesinti yalnız yedek ve
# yeniden başlatma süresidir (birkaç saniye). Yedekler: ./yedek/<zaman>/ (son 10).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31mHATA:\033[0m %s\n' "$*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || die "Root olarak çalıştırın: sudo bash deploy/guncelle.sh"
cd "$ROOT"
[[ -f .env ]] || die ".env yok; önce deploy/kurulum.sh çalıştırın."

if [[ -d .git ]]; then
  say "Kod güncelleniyor"
  git pull --ff-only
fi

say "Yeni imaj derleniyor (uygulama bu sırada çalışmaya devam eder)"
docker compose build app

# Tutarlı kopya için uygulama kısa süre durdurulur (SQLite yazılırken kopyalanmaz);
# günlük dosyası (-wal) varsa o da alınır.
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "yedek/$stamp"
say "Veritabanı yedekleniyor: yedek/$stamp/"
docker compose stop app
docker compose run --rm --no-deps --user root -v "$ROOT/yedek/$stamp:/yedek" --entrypoint sh app \
  -c 'for f in /data/trai-pro.db /data/trai-pro.db-wal; do if [ -f "$f" ]; then cp "$f" /yedek/; fi; done'
ls -1dt yedek/*/ 2>/dev/null | tail -n +11 | xargs -r rm -rf

say "Uygulama başlatılıyor"
docker compose up -d
id="$(docker compose ps -q app)"
for _ in $(seq 1 60); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null)" == healthy ]]; then
    docker image prune -f >/dev/null
    say "Güncelleme tamam."
    exit 0
  fi
  sleep 5
done
docker compose logs --tail 50 app >&2
die "Uygulama 5 dakikada hazır olmadı; yukarıdaki kayıtlara bakın. Geri dönüş: deploy/YAYIN.md, \"Sorun giderme\" (veritabanı yedeği yedek/$stamp/)."
