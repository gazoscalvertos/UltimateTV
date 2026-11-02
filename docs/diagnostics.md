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

- **Self-test** (the last run): each step, whether the household said yes or no, the mode and
  picture the box reported while the clip played, and any button on the remote that never
  arrived. See below.

Every address in a log line is cut to its host (`http://iptv.example/…`): IPTV addresses carry
the account's username and password, and Jellyfin's an API key.

## Reading the playback samples

- `drop`/`late`/`mistimed` going up steadily (`+n` on every line): the screen's refresh rate
  doesn't suit the video. Look at `screen` and `match`; on a TV with 24 Hz modes `match` should
  be `mode`.
- `dec` going up: the decoder can't keep up (check `hwdec` isn't `no`).
- `buffer` falling towards 0 and `in` low: the network or the source.

## The self-test

Settings › About › Self-test on the TV walks through short clips the box makes itself: 4K HDR10,
HLG, 23.976 and 50 frames a second, a surround tone and a stereo tone. Each one asks a single
question ("Does the TV say HDR?"), and the answer is recorded with what the box was actually doing
at the time — the screen mode, the picture size and format, the sound format and the decoder. Then
it asks for every button on the remote in turn and lists any that never arrived.

The point is the pair of facts, not the answer on its own. "No HDR" plus a reported mode of
`1920×1080 · SDR` is a mode problem; "no HDR" plus `3840×2160 · HDR` is a TV setting. A button that
never arrives is either mis-mapped in `tools/box/files/cec-keymap.toml` or isn't reaching the box.

The last run is on the phone's Stats page and in `GET /api/diagnostics?format=text`, and it lasts
until the next run. It is also sent to the Hub when it finishes, so it can be read without the TV
being on; `DELETE /api/selftest` forgets it.

The clips are made by `tools/box/install.sh` at install time, and again by the box the first time
the self-test runs if they are missing (so it still works after an update on a box with no network).
They are four seconds each and 1080p at most, except the HDR10 one, which has to be 4K to prove
anything. Nothing is shipped in the repo. If ffmpeg can't make one, the step is offered as skipped
rather than failing the run.
