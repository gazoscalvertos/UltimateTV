# UltimateTV Hub: API, the TV app, the setup page and phone remote, the probe page, plus ffmpeg
# with Intel Quick Sync.

FROM node:26-bookworm-slim AS build
WORKDIR /app
# The box shell's Electron isn't needed in the Hub image.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY shared/package.json shared/
COPY hub/package.json hub/
COPY ui/package.json ui/
COPY box/package.json box/
COPY tools/probe/package.json tools/probe/
RUN npm ci
COPY shared shared
COPY hub hub
COPY ui ui
COPY tools/probe tools/probe
RUN npm run build -w shared && npm run build -w tools/probe && npm run build -w hub && npm run build -w ui

# comskip finds the advert breaks in recordings (hub/src/adskip.ts). Not packaged by Debian, so
# built here from a pinned commit against the same FFmpeg libraries the final image has.
FROM debian:bookworm-slim AS comskip
ARG COMSKIP_COMMIT=a140b6ac8bc8f596729e9052819affc779c3b377
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git build-essential autoconf automake libtool pkg-config \
      libargtable2-dev libavformat-dev libavcodec-dev libavutil-dev libswscale-dev \
 && git init -q /src && git -C /src fetch -q --depth 1 https://github.com/erikkaashoek/Comskip.git "$COMSKIP_COMMIT" \
 && git -C /src checkout -q FETCH_HEAD \
 && cd /src && ./autogen.sh && ./configure && make -j"$(nproc)" \
 && strip comskip

FROM node:26-bookworm-slim AS deps
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY hub/package.json hub/
COPY ui/package.json ui/
COPY box/package.json box/
COPY tools/probe/package.json tools/probe/
RUN npm ci --omit=dev

FROM node:26-bookworm-slim
# intel-media-va-driver-non-free is the iHD VA-API driver that supports the N150's AV1 decode and HEVC encode.
RUN sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg vainfo intel-media-va-driver-non-free python3 bash ca-certificates libargtable2-0 \
 && rm -rf /var/lib/apt/lists/*
# yt-dlp finds and downloads the music video channels' videos. The standalone build bundles what
# YouTube needs (it uses this image's Node as its JavaScript runtime); the Hub updates it daily.
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux /usr/local/bin/yt-dlp
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data CLIPS_DIR=/clips PROBE_DIR=/app/tools/probe/dist
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/hub/package.json hub/
COPY --from=build /app/hub/dist hub/dist
COPY --from=build /app/hub/public hub/public
COPY --from=build /app/hub/packs hub/packs
# What's new in the apps (GET /api/changelog).
COPY CHANGELOG.md ./
COPY --from=build /app/ui/dist ui/dist
COPY --from=build /app/tools/probe/dist tools/probe/dist
COPY --from=comskip /src/comskip /usr/local/bin/comskip
COPY tools/clips/make-test-clips.sh /usr/local/bin/make-test-clips
COPY tools/iptv/check-catchup.mjs tools/iptv/check-catchup.mjs
# The commit and date this image was built from, shown in Settings › About (tools/hub/update.sh sets them).
ARG GIT_COMMIT=""
ARG BUILD_DATE=""
ENV GIT_COMMIT=$GIT_COMMIT BUILD_DATE=$BUILD_DATE
EXPOSE 8080 8443
VOLUME ["/data"]
# Docker asks the Hub how it is (#96): the image has no curl, so node reads /api/health, which is
# 200 with "ok": false when the Hub is degraded. Three misses in a row (a minute and a half, after
# the first minute) mark it unhealthy; docker-compose.yml's autoheal service restarts it then.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>r.json()).then(b=>process.exit(b.ok?0:1),()=>process.exit(1))"
CMD ["node", "hub/dist/index.js"]
