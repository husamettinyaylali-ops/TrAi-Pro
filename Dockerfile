# TrAi Pro — VPS / Node sunucusu imajı.
# Derleme Linux'ta yapılır: SQLite'ın (libsql) yerel modülü hedef platform için kurulur.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
# Kısa video oluşturucu: ffmpeg (libass ile altyazıyı videoya yazar) ve Türkçe
# karakterleri içeren yazı tipi.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/trai-pro.db \
    MEDIA_DIR=/data/media \
    BACKUP_DIR=/data/backups
# Sunucu tek dosya (.output/server/index.mjs) ve izlenen yerel modüllerle gelir;
# migration'lar açılışta drizzle/ klasöründen uygulanır.
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
