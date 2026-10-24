# UltimateTV

A polished, Sky-style TV app for the Hisense 85U7STUK, running on a Linux mini PC plugged into the TV: live IPTV/Xtream with EPG and series link, VOD, Jellyfin, AIOStreams/TorBox and local NAS files in one place.

See [docs/PLAN.md](docs/PLAN.md) for the product and technical plan.

## Phase 0: set up the server and probe the box

The Hub runs in Docker on the home server ([docs/phase0](docs/phase0/README.md)). A probe script checks what a Linux box on the TV can do ([docs/phase0/box-probe.md](docs/phase0/box-probe.md)).

```sh
cp .env.example .env   # set RENDER_GID
docker compose up -d --build
docker compose exec hub make-test-clips
# then on the box: HUB_URL=http://<server-ip>:8080 bash tools/box/probe.sh
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
| `tools/box/` | Box probe (and, from Phase 0b, the installer) |
| `tools/probe/` | The VIDAA browser probe from Phase 0 (kept as a record) |
| `tools/clips/` | Test clip generator |
| `tools/iptv/` | IPTV catch-up checker |
| `ui/` | The TV UI (from Phase 1) |
| `docs/` | Plan, decisions and Phase 0 guides |
