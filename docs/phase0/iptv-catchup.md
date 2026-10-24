# Testing IPTV catch-up

With one IPTV connection, series link mostly relies on catch-up: a programme is fetched from the provider's archive overnight instead of being recorded live. This checks which channels have it, and that it really works.

Run it inside the Hub from the UltimateTV folder. Credentials are passed in for that one command and never saved.

```sh
export XTREAM_URL='http://your-provider:port' XTREAM_USER='…' XTREAM_PASS='…'
alias catchup='docker compose exec -e XTREAM_URL -e XTREAM_USER -e XTREAM_PASS hub node tools/iptv/check-catchup.mjs'
catchup --filter "UK"
```

This lists each channel with catch-up and how many days it keeps. Then test a real fetch on a few key channels. Stop anything else that's streaming first, because this uses your one connection for a few seconds.

```sh
catchup --test "BBC One"
catchup --test "ITV"
catchup --test "Channel 4"
```

`OK` means the provider served a programme from two hours ago. If it fails, the provider may use a different time zone for catch-up. Note that in the results, because the Hub will need a time-zone offset setting.

Copy the output (no credentials appear in it) into `docs/phase0/capability-matrix.md`.
