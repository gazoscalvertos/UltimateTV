# The PlayStation 5 title (EVO engine + UltimateTV provider)

`provider_ultimatetv.c` is the UltimateTV side of the console app; `build-title.sh` builds it into an installable title. The reasons are in [docs/ps5-architecture.md](../../docs/ps5-architecture.md). The older SDL app in `ps5/src` is retired once this plays on a real console.

```
./build-title.sh --check     # compile the provider against EVO's real headers (needs only curl and gcc)
./build-title.sh             # the full build (needs Docker); EVO_REF pins EVO, UTV_HUB sets the default Hub
```

Config on the console, first file found wins: `/data/evoplayer/ultimatetv.conf`, `/download0/evoplayer/ultimatetv.conf`, `/mnt/usb0/.evo_ultimatetv.conf`:

```
hub=http://192.168.0.19:8095
```

GPL-3.0-or-later, because EVO Player is.
