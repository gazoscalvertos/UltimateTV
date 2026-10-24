# UltimateTV

A polished, Sky-style TV app for the Hisense 85U7STUK: live IPTV/Xtream with EPG and series link, VOD, Jellyfin, AIOStreams/TorBox and local NAS files in one place.

See [docs/PLAN.md](docs/PLAN.md) for the product and technical plan.

## Phase 0: try it on your TV

The Hub serves a capability probe that you open in the TV's browser. Setup is in [docs/phase0](docs/phase0/README.md).

```sh
cp .env.example .env   # set RENDER_GID
docker compose up -d --build
docker compose exec hub make-test-clips
# then on the TV: http://<server-ip>:8080/
```

## Development

```sh
npm install
npm run typecheck && npm test
npm run build
DATA_DIR=./data CLIPS_DIR=./test-clips npm run dev:hub
```

| Folder | What it is |
|--------|------------|
| `shared/` | Types and logic shared by the Hub and the TV (probe report, capability matrix) |
| `hub/` | The home server: API, probe hosting, Quick Sync checks |
| `tools/probe/` | The capability probe page that runs on the TV |
| `tools/clips/` | Test clip generator |
| `tools/iptv/` | IPTV catch-up checker |
| `tv/` | The TV app (from Phase 1) |
| `docs/` | Plan, decisions and Phase 0 guides |
