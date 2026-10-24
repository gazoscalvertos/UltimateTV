# UltimateTV Hub: API, probe page and (later) the TV app, plus ffmpeg with Intel Quick Sync.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY shared/package.json shared/
COPY hub/package.json hub/
COPY tools/probe/package.json tools/probe/
RUN npm ci
COPY shared shared
COPY hub hub
COPY tools/probe tools/probe
RUN npm run build

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY hub/package.json hub/
COPY tools/probe/package.json tools/probe/
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
# intel-media-va-driver-non-free is the iHD VA-API driver that supports the N150's AV1 decode and HEVC encode.
RUN sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg vainfo intel-media-va-driver-non-free python3 bash ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data CLIPS_DIR=/clips PROBE_DIR=/app/tools/probe/dist
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/hub/package.json hub/
COPY --from=build /app/hub/dist hub/dist
COPY --from=build /app/tools/probe/dist tools/probe/dist
COPY tools/clips/make-test-clips.sh /usr/local/bin/make-test-clips
COPY tools/iptv/check-catchup.mjs tools/iptv/check-catchup.mjs
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "hub/dist/index.js"]
