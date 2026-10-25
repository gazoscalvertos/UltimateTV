# Music video channels

The Hub makes its own live channels out of music videos. It downloads 30 or so HD or 4K videos per
channel to the NAS with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and plays them like any other
channel: they're in the TV Guide (under **Music**), with a programme for each video, and channel
up and down, the banner and search all work as usual.

A new Hub starts with three:

| Number | Channel | What it plays |
|--------|---------|---------------|
| 390 | Clubland TV | UK club anthems and Eurodance, 1998 to 2012 |
| 391 | House TV | Classic, vocal, French touch and modern house |
| 392 | Halloween TV | Spooky pop and rock, fine for a family party |

Each one names about forty tracks (in `hub/src/mixseeds.ts`), more than it needs, because some only
exist in SD on YouTube and are skipped. A few broader searches fill any gap.

## How the shuffle works

Every pass through a channel's videos is a new shuffle: each video plays once per pass, the order
is never the same as the pass before, and the last video of one pass never starts the next. The
Hub writes two days of this into the guide and tops it up every half hour. Adding or taking away a
video reshuffles everything after the one on now.

When the TV tunes in, it starts the video on now from where the schedule has got to, then plays
the next six hours of videos straight on (mpv's playlist), and tunes in again when they run out.

Every video fills the screen. After each download the Hub runs ffmpeg's cropdetect over the
keyframes to find black bars baked into the upload (a 4:3 video pillarboxed into 16:9, a film-style
letterbox) and the box crops them off (mpv `video-crop`). Whatever is left that isn't 16:9 is
zoomed to fill (mpv `panscan=1`), trimming the edges rather than showing bars. Videos downloaded
before this are checked once when the Hub starts.

Like a music TV channel, a caption slides in at the bottom left as each video starts: the
channel's logo, **Now playing**, the artist and the song. For the last five seconds of each video
it shows **Coming up next** with the next artist and song. On the box the timing comes from mpv
(which video of the playlist is on, and how long it has left); in a browser it follows the guide.

## On the TV

**Settings › Music channels** shows each channel, how many videos are ready and what the Hub is
doing. OK on a channel opens it:

- **Watch** it.
- **Add artists or songs**: type them with commas between. `Artist - Title` is a specific song;
  anything else ("Oasis", "90s indie") becomes a search.
- **Find more videos now** (otherwise a channel short of videos is looked at every six hours).
- **Shuffle again.**
- **Channel options**: rename, describe it, number of videos, picture quality (HD or 4K, Full HD
  or 4K, HD only), turn off, delete.
- OK on a video takes it off the channel. The Hub won't pick it again and finds another.

**Create a channel** asks for a name and what it should play ("Oasis, Blur, Pulp, 90s Britpop").
Each part between commas becomes a search for official videos.
Each pass reads a search 25 results at a time, up to three pages, and the next pass carries on
where it stopped (down to the 200th result, then from the top again). A channel that is still
short but found something looks again straight after, and every channel short of videos looks
again when the Hub restarts.

A download that gets nothing from YouTube for five minutes is stopped and tried once more, so one
hung video can't hold up the rest.

## What the Hub accepts

- At least 720p (or 1080p if you choose Full HD), up to 4K. The best version is downloaded.
- 1½ to 10 minutes long. No live streams, no age-restricted videos.
- Not a lyric video, audio upload, visualiser, reaction, karaoke, hour-long version, teaser,
  slowed/reverb or nightcore edit (the list is `DEFAULT_EXCLUDE` in `hub/src/ytdlp.ts`).
- For a named song, the title and channel must match most of the artist and title words. Official
  videos, VEVO channels, YouTube Music's artist and track details, 1080p and 4K, and views all
  score higher.
- The same song twice on one channel (an official upload and a remaster) is skipped.

## Where the videos go

`Music Videos` on the NAS (`/mnt/nas/Music Videos` inside the Hub; set `MUSIC_VIDEOS_PATH` to
change it), one `<video id>.mkv` and a `.jpg` thumbnail per video. A video on two channels is kept
once. Deleting a channel or taking a video off deletes the file unless another channel has it.
Downloads stop while the NAS has less than 10 GB free. 30 videos take roughly 5 GB in HD and
15 GB in 4K.

The Hub's Docker image includes yt-dlp and updates it once a day, because YouTube changes often
enough to break old versions. If YouTube starts asking yt-dlp to sign in, put extra arguments in
`YTDLP_ARGS` in the Hub's `.env` (for example `--cookies /data/youtube-cookies.txt`).

## For an AI curator later

Each channel has a **brief** (what it's for, in plain words) and a **curator** (`search` now;
`llm` is reserved and, until an LLM is set up, works the same as `search`). A curator only has to
turn the brief into two lists, implementing `Curator.plan()` in `hub/src/mixchannels.ts`:

- `picks`: specific tracks, `Artist - Title`, each searched for its official video;
- `queries`: broader searches used to fill up to the target.

An outside agent (Claude, or a local LLM on the box) can also drive it over HTTP:

| Call | What it does |
|------|--------------|
| `GET /api/mix-channels` | Every channel with its counts, the downloader's state and free space |
| `GET /api/mix-channels/:id` | One channel and its videos, with how each was found |
| `POST /api/mix-channels` | Create: `{ name, brief, picks?, queries?, exclude?, target?, minHeight?, maxHeight?, maxMinutes?, curator? }` |
| `PATCH /api/mix-channels/:id` | Change any of those, or `enabled` |
| `DELETE /api/mix-channels/:id` | Delete the channel (and files no other channel uses) |
| `GET /api/mix/search?q=…&channel=…` | YouTube results judged against a channel's rules: `score` and `rejected` reasons |
| `POST /api/mix-channels/:id/videos` | Add a video: `{ url }` or `{ id }`, with `origin` ("llm: upbeat opener") |
| `DELETE /api/mix-channels/:id/videos/:videoId` | Take one off (it won't be picked again) |
| `POST /api/mix-channels/:id/curate` | Fill up to the target now |
| `POST /api/mix-channels/:id/shuffle` | Reshuffle after the video on now |

Changes need an adult profile (`X-Profile: family`, plus the PIN token once a PIN is set), like
the rest of Settings.
