# Testing IPTV catch-up

With one IPTV connection, series link mostly relies on catch-up: a programme is fetched from the provider's archive overnight instead of being recorded live. This checks which channels have it, and that it really works.

Run from any machine with Node 22 (the Docker container works). Credentials are read from the environment and never saved.

```sh
export XTREAM_URL='http://your-provider:port' XTREAM_USER='…' XTREAM_PASS='…'
node tools/iptv/check-catchup.mjs --filter "UK"
```

This lists each channel with catch-up and how many days it keeps. Then test a real fetch on a few key channels. Stop anything else that's streaming first, because this uses your one connection for a few seconds.

```sh
node tools/iptv/check-catchup.mjs --test "BBC One"
node tools/iptv/check-catchup.mjs --test "ITV"
node tools/iptv/check-catchup.mjs --test "Channel 4"
```

`OK` means the provider served a programme from two hours ago. If it fails, the provider may use a different time zone for catch-up. Note that in the results, because the Hub will need a time-zone offset setting.

Copy the output (no credentials appear in it) into `docs/phase0/capability-matrix.md`.
