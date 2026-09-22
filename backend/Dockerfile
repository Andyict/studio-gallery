FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3211 HOST=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends libimage-exiftool-perl ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/src ./src
COPY scripts/backup.mjs ./backup.mjs
RUN chmod -R a+rX /app
USER node
EXPOSE 3211
CMD ["node","src/server.mjs"]
