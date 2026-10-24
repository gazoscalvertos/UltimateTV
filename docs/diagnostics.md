# Diagnostics

The Hub collects what's needed to look into a playback or box problem, so nobody needs a login on
the box or the Docker container.

```sh
curl -s http://192.168.0.19:8095/api/diagnostics?format=text | less
```

Without `?format=text` the same comes back as JSON.

## Rolling logs

The Hub also keeps detailed logs on disk, in its data volume (`data/logs`), each rolling over at
10 MB with four older files kept, so each takes at most 50 MB:

| Log | What | Read it |
|---|---|---|
| `hub.log` | Everything the Hub logs, debug level and up (`LOG_LEVEL` in `.env` changes it) | `curl -s 'http://192.168.0.19:8095/api/diagnostics/logs/hub?lines=2000'` |
| `box.log` | Every line of the box's log, as its reports arrive | `…/api/diagnostics/logs/box` |
| `playback.jsonl` | Every 10-second playback sample, one JSON object a line | `…/api/diagnostics/logs/playback` |

`lines` defaults to 500 and goes up to 50,000. `docker logs` shows info and up, and rolls over at
10 MB with three files kept.

## What's in it

- **Hub**: version, commit, uptime and its last 1000 log lines (routine requests left out).
- **Box** (its latest report): software version, uptime, load, memory, the screen as
  `kscreen-doctor` sees it (`-o` text and `-j` JSON with the mode lists cut down), and its last
  1000 log lines.
- **Playback samples**: one every 10 seconds while something plays, for the last two hours:
  position, video size, frame rate and decoder, the screen mode, how the screen was matched to
  the video (a fitting mode, variable refresh or none), mpv's sync mode, dropped, late and
  mistimed frames (running totals, with the change since the previous sample as `+n`), A/V sync,
  buffer and download rate.

The box reports a few seconds after it starts, when playback starts and stops, every 30 seconds
while playing and every 5 minutes otherwise. The Hub keeps the latest report in
`data/diagnostics/box.json`, so it survives a restart.

Every address in a log line is cut to its host (`http://iptv.example/…`): IPTV addresses carry
the account's username and password, and Jellyfin's an API key.

## Reading the playback samples

- `drop`/`late`/`mistimed` going up steadily (`+n` on every line): the screen's refresh rate
  doesn't suit the video. Look at `screen` and `match`; on a TV with 24 Hz modes `match` should
  be `mode`.
- `dec` going up: the decoder can't keep up (check `hwdec` isn't `no`).
- `buffer` falling towards 0 and `in` low: the network or the source.
